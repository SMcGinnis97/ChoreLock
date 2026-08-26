#!/usr/bin/env node
// AdGuard Home backend self-test. Run to verify the agent can talk to AdGuard
// Home and block/unblock a device by DNS.
//
//   node bin/adguard.js                 show status + current ChoreLock rules
//   node bin/adguard.js block <MAC>     register client + add a block-all rule
//   node bin/adguard.js unblock <MAC>   remove the block rule for <MAC>
//   node bin/adguard.js rules           dump ALL user rules (incl. non-ChoreLock)
import { loadConfig } from '../src/config.js';
import { log } from '../src/log.js';
import { AdguardClient, reconcileAdguard, _internal } from '../src/adguard.js';
import { normalizeMac } from '../src/reconcile.js';

async function currentBlocked(ag) {
  const rules = await ag.getUserRules();
  return rules.filter(_internal.isOwnedRule).map(_internal.macFromRule).filter(Boolean);
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.adguard) throw new Error('Set ENFORCE_BACKEND=adguard (or both) and the ADGUARD_* env vars first.');
  const ag = new AdguardClient(cfg.adguard);
  const [cmd, macArg] = process.argv.slice(2);

  const st = await ag.status();
  console.log(`AdGuard Home v${st.version || '?'} — protection ${st.protection_enabled ? 'ON' : 'OFF'}, running=${st.running}`);
  console.log(`DNS on: ${JSON.stringify(st.dns_addresses || [])}\n`);

  if (!cmd) {
    console.log('ChoreLock-blocked MACs:', JSON.stringify(await currentBlocked(ag)));
    log.info('AdGuard reachable. Login + rule read work.');
  } else if (cmd === 'block' || cmd === 'unblock') {
    const mac = normalizeMac(macArg || '');
    if (!mac) throw new Error(`Usage: adguard.js ${cmd} <MAC>`);
    const desired = new Set(await currentBlocked(ag));
    if (cmd === 'block') desired.add(mac);
    else desired.delete(mac);
    await reconcileAdguard(ag, desired, {});
    console.log('Now blocked:', JSON.stringify(await currentBlocked(ag)));
    if (cmd === 'block') {
      log.info(`Rule added. On the target device (using AdGuard for DNS), a FRESH page load should now fail.`);
      log.info(`Tip: on the device run  nslookup example.com ${(cfg.adguard.url.match(/\/\/([^:/]+)/) || [])[1] || '<agh-ip>'}`);
    }
  } else if (cmd === 'rules') {
    console.log((await ag.getUserRules()).join('\n') || '(no user rules)');
  } else {
    throw new Error(`Unknown command "${cmd}". Use: (none) | block <MAC> | unblock <MAC> | rules`);
  }
}

main().catch((e) => {
  log.error('AdGuard self-test failed:', e.message);
  process.exit(1);
});
