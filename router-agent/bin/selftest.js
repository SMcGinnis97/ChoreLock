#!/usr/bin/env node
// Live router self-test. Run this FIRST (before trusting enforcement) to prove
// the API login + deny-list read/write against the real HB210.
//
//   node bin/selftest.js                 login + print deny list + ACL master (read-only)
//   node bin/selftest.js block <MAC>     add+enable a deny rule and turn the master ON
//   node bin/selftest.js unblock <MAC>   remove one ChoreLock rule for <MAC>
//   node bin/selftest.js restore         remove ALL ChoreLock rules + master OFF (baseline)
import { loadConfig } from '../src/config.js';
import { log } from '../src/log.js';
import { RouterClient } from '../src/router.js';

const RULE_PREFIX = 'ChoreLock:';
const normalize = (m) => m.replace(/[^0-9a-fA-F]/g, '').toUpperCase().match(/.{2}/g)?.join(':');

async function printList(router) {
  const rules = await router.readDenyList();
  const master = await router.readAclMaster();
  console.log(`\nACL master (X_TP_EnableACL): ${master ? 'ON' : 'OFF'}`);
  console.log(`Deny list (${rules.length} rule(s)):`);
  if (!rules.length) console.log('  (empty)');
  for (const r of rules) {
    const own = r.name.startsWith(RULE_PREFIX) ? ' [ChoreLock]' : '';
    console.log(`  stack=${r.stack}  ${r.enable ? 'enabled ' : 'disabled'}  ${r.mac || '(no mac)'}  "${r.name}"${own}`);
  }
  console.log('');
  return rules;
}

async function main() {
  const cfg = loadConfig();
  const [cmd, macArg] = process.argv.slice(2);
  const router = new RouterClient(cfg.router);

  await router.login();

  if (!cmd) {
    await printList(router);
    log.info('Read-only self-test OK. Login and deny-list read both work.');
  } else if (cmd === 'block') {
    const mac = normalize(macArg || '');
    if (!mac) throw new Error('Usage: selftest block <MAC>');
    log.info(`Adding deny rule for ${mac} and turning the ACL master ON...`);
    await router.addDenyRule(mac, `${RULE_PREFIX}${mac}`);
    await router.setAclMaster(true);
    await printList(router);
    log.info(`Now check the target device: it should stay on Wi-Fi but lose internet (WAN).`);
    log.info(`When done: node bin/selftest.js restore`);
  } else if (cmd === 'unblock') {
    const mac = normalize(macArg || '');
    if (!mac) throw new Error('Usage: selftest unblock <MAC>');
    const rules = await router.readDenyList();
    const hit = rules.find((r) => r.mac === mac && r.name.startsWith(RULE_PREFIX));
    if (!hit) log.warn(`No ChoreLock rule found for ${mac}.`);
    else await router.delRule(hit.stack);
    if ((await router.readDenyList()).length === 0) await router.setAclMaster(false);
    await printList(router);
  } else if (cmd === 'restore') {
    log.info('Removing all ChoreLock-owned rules and restoring baseline (master OFF if list empties)...');
    for (const r of (await router.readDenyList()).filter((r) => r.name.startsWith(RULE_PREFIX))) {
      log.info(`  deleting ${r.mac} (${r.stack})`);
      await router.delRule(r.stack);
    }
    if ((await router.readDenyList()).length === 0) await router.setAclMaster(false);
    await printList(router);
  } else {
    throw new Error(`Unknown command "${cmd}". Use: (none) | block <MAC> | unblock <MAC> | restore`);
  }

  await router.logout();
}

main().catch((e) => {
  log.error('Self-test failed:', e.message);
  process.exit(1);
});
