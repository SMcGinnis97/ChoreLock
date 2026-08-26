#!/usr/bin/env node
// ChoreKey enforcement agent — always-on reconcile loop.
//   realtime nudge + POLL_INTERVAL backstop -> compute desired blocked set ->
//   reconcile the chosen backend(s). Fails OPEN: any ambiguity or unreachable
//   backend leaves devices untouched (kids keep internet).
//
// Backends (ENFORCE_BACKEND): 'adguard' (DNS block via AdGuard Home — default,
// reliable), 'router' (HB210 Access Control — best-effort, firmware-limited),
// or 'both'.
import { loadConfig } from './config.js';
import { log } from './log.js';
import { RouterClient } from './router.js';
import { AdguardClient, reconcileAdguard } from './adguard.js';
import { makeClient, fetchState, subscribe } from './supabase.js';
import { computeDesired, reconcile } from './reconcile.js';

const cfg = loadConfig();
const once = process.argv.includes('--once');

const router = cfg.useRouter ? new RouterClient(cfg.router) : null;
const adguard = cfg.useAdguard ? new AdguardClient(cfg.adguard) : null;
const supabase = makeClient(cfg.supabase);

let running = false;
let pending = false;
let lastDesiredKey = null;

async function tick(trigger) {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  try {
    // 1) Read desired state. A failure here is "ambiguous" -> touch nothing.
    let state;
    try {
      state = await fetchState(supabase, cfg.supabase.familyId);
    } catch (e) {
      log.warn(`Supabase read failed (${trigger}); leaving enforcement untouched (fail open): ${e.message}`);
      return;
    }

    const { macs, detail } = computeDesired(state, { scheduleIsAllowedWindow: cfg.scheduleIsAllowedWindow });
    const desiredKey = [...macs].sort().join(',');
    if (desiredKey !== lastDesiredKey || cfg.dryRun) {
      log.info(`Desired blocked (${macs.size}): [${desiredKey || '(none)'}]  trigger=${trigger}`);
      for (const d of detail) log.debug(`  ${d.blocked ? 'BLOCK' : 'allow'} ${d.mac} "${d.name}" — ${d.reason}`);
    }

    // 2) Reconcile each backend independently (one failing must not block the other).
    let allOk = true;
    if (adguard) {
      try {
        await reconcileAdguard(adguard, macs, { dryRun: cfg.dryRun });
      } catch (e) {
        allOk = false;
        log.warn(`AdGuard reconcile failed (${trigger}); will retry next tick: ${e.message}`);
      }
    }
    if (router) {
      try {
        await reconcile(router, macs, { dryRun: cfg.dryRun });
      } catch (e) {
        allOk = false;
        log.warn(`Router reconcile failed (${trigger}); will retry next tick: ${e.message}`);
      }
    }
    if (allOk) lastDesiredKey = desiredKey;
  } finally {
    running = false;
    if (pending) {
      pending = false;
      setTimeout(() => tick('debounced'), 250);
    }
  }
}

async function main() {
  log.info(`ChoreKey agent starting. backend=${cfg.backend} dryRun=${cfg.dryRun} poll=${cfg.pollIntervalMs / 1000}s`);
  if (cfg.supabase.familyId) log.info(`Scoped to family ${cfg.supabase.familyId}.`);

  if (once) {
    await tick('once');
    if (router) await router.logout().catch(() => {});
    return;
  }

  subscribe(supabase, () => tick('realtime'));
  await tick('startup');
  const timer = setInterval(() => tick('poll'), cfg.pollIntervalMs);

  const shutdown = async (sig) => {
    log.info(`${sig} received; shutting down. (Existing blocks stay until the next agent run.)`);
    clearInterval(timer);
    if (router) await router.logout().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  log.error('Fatal:', e.message);
  process.exit(1);
});
