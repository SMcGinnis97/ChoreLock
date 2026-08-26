// Desired-state computation + idempotent reconciliation against the router.
import { log } from './log.js';

const RULE_PREFIX = 'ChoreLock:';

/** Normalize a MAC to uppercase colon form, or null if it doesn't look like one. */
export function normalizeMac(raw) {
  if (!raw) return null;
  const hex = String(raw).replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g).join(':');
}

/** Current family-local "HH:MM" for a timezone (falls back to host local time). */
function localHhmm(tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: tz || undefined,
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  }
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Is `now` within [start, end)? Supports overnight windows (start > end). */
export function inWindow(nowHhmm, startTime, endTime) {
  const now = toMinutes(nowHhmm);
  const start = toMinutes(startTime.slice(0, 5));
  const end = toMinutes(endTime.slice(0, 5));
  if (start === end) return true; // zero-width == always
  if (start < end) return now >= start && now < end;
  return now >= start || now < end; // wraps midnight
}

/**
 * Compute the set of MACs that should be on the router deny list right now.
 * @returns {{ macs: Set<string>, detail: Array<{mac,name,blocked,reason}> }}
 */
export function computeDesired(state, { scheduleIsAllowedWindow = true } = {}) {
  const detail = [];
  const macs = new Set();

  for (const dev of state.devices) {
    const mac = normalizeMac(dev.identifier);
    if (!mac) {
      log.warn(`Skipping device "${dev.name}" (${dev.id}): identifier "${dev.identifier}" is not a MAC.`);
      continue;
    }

    // Base lock from ownership.
    let blocked;
    let reason;
    if (dev.kid_id) {
      blocked = state.lockByKid.get(dev.kid_id) === 'locked';
      reason = blocked ? 'kid locked' : 'kid unlocked';
      // If the kid has no lock-state row we treat it as unlocked (fail open).
      if (!state.lockByKid.has(dev.kid_id)) reason = 'kid has no lock state (open)';
    } else if (dev.family_id) {
      const clear = state.clearByFamily.get(dev.family_id);
      blocked = clear === false; // only block when we positively know it's not clear
      reason = blocked ? 'family not all-clear' : 'family all-clear (or unknown)';
    } else {
      blocked = false;
      reason = 'device owns no kid/family (open)';
    }

    // Schedule window (curfew). Overrides base lock in the blocking direction.
    if (dev.schedule_start && dev.schedule_end) {
      const tz = state.tzByFamily.get(dev.family_id || null);
      const within = inWindow(localHhmm(tz), dev.schedule_start, dev.schedule_end);
      const scheduleBlocks = scheduleIsAllowedWindow ? !within : within;
      if (scheduleBlocks && !blocked) {
        blocked = true;
        reason = scheduleIsAllowedWindow ? 'outside allowed window' : 'inside block window';
      }
    }

    // Manual override wins over everything.
    if (dev.override === 'unlock') {
      blocked = false;
      reason = 'override: unlock';
    } else if (dev.override === 'lock') {
      blocked = true;
      reason = 'override: lock';
    }

    if (blocked) macs.add(mac);
    detail.push({ mac, name: dev.name, blocked, reason });
  }

  return { macs, detail };
}

const ownedName = (mac) => `${RULE_PREFIX}${mac}`;
const isOwned = (rule) => rule.name.startsWith(RULE_PREFIX);

/**
 * Reconcile the router's deny list to `desiredMacs`. Only ever touches
 * ChoreLock-owned rules. Keeps the ACL master ON while any block exists and
 * restores the baseline (master OFF) only when the whole list is empty.
 * Idempotent and safe to run every tick.
 */
export async function reconcile(router, desiredMacs, { dryRun = false } = {}) {
  const rules = await router.readDenyList();
  const owned = rules.filter(isOwned);
  const ownedMacs = new Set(owned.map((r) => r.mac));

  const toBlock = [...desiredMacs].filter((m) => !ownedMacs.has(m));
  const toUnblock = owned.filter((r) => !desiredMacs.has(r.mac));
  // A previously-added rule that somehow got disabled needs re-enabling.
  const toReenable = owned.filter((r) => desiredMacs.has(r.mac) && !r.enable);

  const plan = { toBlock, toUnblock: toUnblock.map((r) => r.mac), toReenable: toReenable.map((r) => r.mac) };

  if (dryRun) {
    log.info('[dry-run] plan:', JSON.stringify(plan));
    return { plan, applied: false };
  }

  for (const mac of toBlock) {
    log.info(`Blocking ${mac}`);
    await router.addDenyRule(mac, ownedName(mac));
  }
  for (const rule of toUnblock) {
    log.info(`Unblocking ${rule.mac}`);
    await router.delRule(rule.stack);
  }
  for (const rule of toReenable) {
    log.info(`Re-enabling ${rule.mac}`);
    await router.enableRule(rule.stack, true);
  }

  // Master toggle: ON if we want any block; OFF only when the whole deny list is empty.
  const after = await router.readDenyList();
  const anyDesired = desiredMacs.size > 0;
  const anyRulesLeft = after.length > 0;
  if (anyDesired) {
    await router.setAclMaster(true);
  } else if (!anyRulesLeft) {
    await router.setAclMaster(false); // restore proven baseline
  } // else: foreign rules remain -> leave the master as the human set it.

  // Verify: every desired MAC should be present + enabled among owned rules.
  const afterOwned = after.filter(isOwned);
  const afterEnabled = new Set(afterOwned.filter((r) => r.enable).map((r) => r.mac));
  const missing = [...desiredMacs].filter((m) => !afterEnabled.has(m));
  const stray = afterOwned.filter((r) => !desiredMacs.has(r.mac)).map((r) => r.mac);
  if (missing.length || stray.length) {
    log.warn(`Verify mismatch (self-heals next tick). missing=${JSON.stringify(missing)} stray=${JSON.stringify(stray)}`);
  }

  return { plan, applied: true, missing, stray };
}
