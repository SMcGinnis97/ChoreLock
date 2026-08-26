// AdGuard Home enforcement backend.
//
// Enforcement primitive: a per-client DNS "block everything" filtering rule.
// When a device must be blocked, the agent ensures AdGuard Home knows it as a
// persistent client (identified by MAC) and adds a catch-all user rule scoped to
// that client (`/.*/$client="<name>"`). All the device's DNS lookups are then
// refused -> no internet. Removing the rule restores normal service.
//
// This sidesteps the router-firmware guard entirely and works for every
// non-Apple device. AdGuard Home must be the DNS server the devices use (set via
// the router's DHCP), and DoH-capable devices should be prevented from bypassing
// it (block port 53 + DoH endpoints) -- see README.
import { log } from './log.js';

const CLIENT_PREFIX = 'chorelock_'; // persistent-client + rule marker (ownership)
// Catch-all block rule scoped to one client. Verified/adjustable against the
// live AdGuard Home during setup (see bin/adguard.js selftest).
const blockRule = (name) => `/.*/$client="${name}"`;
const clientName = (mac) => CLIENT_PREFIX + mac.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
const isOwnedRule = (line) => line.includes(`"${CLIENT_PREFIX}`) || line.includes(`=${CLIENT_PREFIX}`);
const macFromRule = (line) => {
  const m = line.match(new RegExp(`${CLIENT_PREFIX}([0-9a-fA-F]{12})`));
  if (!m) return null;
  return m[1].toUpperCase().match(/.{2}/g).join(':');
};

export class AdguardClient {
  constructor({ url, username, password }) {
    this.base = url.replace(/\/+$/, '');
    this.auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  }

  async api(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: this.auth,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`AdGuard ${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 160)}`);
    return text ? JSON.parse(text) : {};
  }

  async status() {
    return this.api('/control/status');
  }

  async getUserRules() {
    const s = await this.api('/control/filtering/status');
    return Array.isArray(s.user_rules) ? s.user_rules : [];
  }

  async setUserRules(rules) {
    await this.api('/control/filtering/set_rules', { method: 'POST', body: { rules } });
  }

  async getClients() {
    const c = await this.api('/control/clients');
    return Array.isArray(c.clients) ? c.clients : [];
  }

  /** Ensure a persistent client identified by `mac` exists (named chorelock_<mac>). */
  async ensureClient(mac, label) {
    const name = clientName(mac);
    const existing = await this.getClients();
    if (existing.some((c) => c.name === name)) return name;
    await this.api('/control/clients/add', {
      method: 'POST',
      body: {
        name,
        ids: [mac.toUpperCase()],
        use_global_settings: true,
        filtering_enabled: true,
        parental_enabled: false,
        safebrowsing_enabled: false,
        safe_search: { enabled: false },
        use_global_blocked_services: true,
        blocked_services: [],
        upstreams: [],
        tags: [],
      },
    });
    log.info(`AdGuard: registered client ${name} (${label || mac})`);
    return name;
  }
}

/**
 * Reconcile AdGuard Home's user rules so exactly `desiredMacs` are blocked.
 * Only touches ChoreLock-owned rules (client name prefixed `chorelock_`); any
 * rule you added by hand is preserved. Idempotent.
 */
export async function reconcileAdguard(ag, desiredMacs, { dryRun = false } = {}) {
  const rules = await ag.getUserRules();
  const foreign = rules.filter((r) => !isOwnedRule(r));
  const ownedMacs = new Set(rules.filter(isOwnedRule).map(macFromRule).filter(Boolean));

  const desired = [...desiredMacs];
  const toBlock = desired.filter((m) => !ownedMacs.has(m));
  const toUnblock = [...ownedMacs].filter((m) => !desiredMacs.has(m));
  const plan = { toBlock, toUnblock };

  if (dryRun) {
    log.info('[dry-run] adguard plan:', JSON.stringify(plan));
    return { plan, applied: false };
  }
  if (toBlock.length === 0 && toUnblock.length === 0) return { plan, applied: false };

  // Make sure every desired MAC is a known client, then rebuild the rule list.
  for (const mac of desired) await ag.ensureClient(mac);
  const desiredRules = desired.map((mac) => blockRule(clientName(mac)));
  await ag.setUserRules([...foreign, ...desiredRules]);

  for (const m of toBlock) log.info(`AdGuard: blocking ${m}`);
  for (const m of toUnblock) log.info(`AdGuard: unblocking ${m}`);

  // Verify.
  const after = new Set((await ag.getUserRules()).filter(isOwnedRule).map(macFromRule).filter(Boolean));
  const missing = desired.filter((m) => !after.has(m));
  if (missing.length) log.warn(`AdGuard verify mismatch (self-heals next tick): missing=${JSON.stringify(missing)}`);
  return { plan, applied: true, missing };
}

export const _internal = { clientName, blockRule, isOwnedRule, macFromRule };
