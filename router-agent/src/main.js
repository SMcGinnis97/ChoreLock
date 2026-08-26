#!/usr/bin/env node
// ChoreKey router agent — always-on reconcile loop.
//   realtime nudge + POLL_INTERVAL backstop -> compute desired deny list ->
//   reconcile the HB210 Access Control list. Fails OPEN: any ambiguity or
//   unreachable router leaves Wi-Fi untouched (kids keep internet).
import { loadConfig } from './config.js';
import { log } from './log.js';
import { RouterClient } from './router.js';
import { makeClient, fetchState, subscribe } from './supabase.js';
import { computeDesired, reconcile } from './reconcile.js';

const cfg = loadConfig();
const once = process.argv.includes('--once');

const router = new RouterClient(cfg.router);
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
    // 1) Read desired state. A failure here is "ambiguous" -> do NOT touch the router.
    let state;
    try {
      state = await fetchState(supabase, cfg.supabase.familyId);
    } catch (e) {
      log.warn(`Supabase read failed (${trigger}); leaving router untouched (fail open): ${e.message}`);
      return;
    }

    const { macs, detail } = computeDesired(state, { scheduleIsAllowedWindow: cfg.scheduleIsAllowedWindow });
    const desiredKey = [...macs].sort().join(',');
    const changed = desiredKey !== lastDesiredKey;
    if (changed || cfg.dryRun) {
      log.info(`Desired blocked (${macs.size}): [${desiredKey || '(none)'}]  trigger=${trigger}`);
      for (const d of detail) log.debug(`  ${d.blocked ? 'BLOCK' : 'allow'} ${d.mac} "${d.name}" — ${d.reason}`);
    }

    // 2) Reconcile the router. A failure here leaves prior state in place (fail open).
    try {
      await reconcile(router, macs, { dryRun: cfg.dryRun });
      lastDesiredKey = desiredKey;
    } catch (e) {
      log.warn(`Router reconcile failed (${trigger}); will retry next tick: ${e.message}`);
    }
  } finally {
    running = false;
    if (pending) {
      pending = false;
      setTimeout(() => tick('debounced'), 250);
    }
  }
}

async function main() {
  log.info(`ChoreKey router agent starting. router=${cfg.router.host} dryRun=${cfg.dryRun} poll=${cfg.pollIntervalMs / 1000}s`);
  if (cfg.supabase.familyId) log.info(`Scoped to family ${cfg.supabase.familyId}.`);

  if (once) {
    await tick('once');
    await router.logout();
    return;
  }

  subscribe(supabase, () => tick('realtime'));
  await tick('startup');
  const timer = setInterval(() => tick('poll'), cfg.pollIntervalMs);

  const shutdown = async (sig) => {
    log.info(`${sig} received; shutting down. (Existing blocks stay until the next agent run.)`);
    clearInterval(timer);
    try {
      await router.logout();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  log.error('Fatal:', e.message);
  process.exit(1);
});
