// Supabase read path. The agent is a trusted LAN appliance and uses the
// service-role key (local to this host) to read lock-state views directly —
// no edge function, no broad grants exposed to the app.
import { createClient } from '@supabase/supabase-js';
import { log } from './log.js';

export function makeClient(cfg) {
  return createClient(cfg.url, cfg.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 2 } },
  });
}

/**
 * Snapshot everything reconciliation needs. Fails loudly (caller treats a throw
 * as "ambiguous -> fail open, don't touch the router").
 */
export async function fetchState(supabase, familyId) {
  const devQ = supabase
    .from('devices')
    .select('id, kid_id, family_id, name, platform, identifier, override, schedule_start, schedule_end')
    .eq('platform', 'other');
  const { data: devices, error: devErr } = familyId
    ? await devQ.eq('family_id', familyId)
    : await devQ;
  if (devErr) throw new Error(`devices read failed: ${devErr.message}`);

  const [{ data: locks, error: lockErr }, { data: clears, error: clearErr }, { data: families, error: famErr }] =
    await Promise.all([
      supabase.from('kid_lock_state').select('kid_id, family_id, state'),
      supabase.from('family_all_clear').select('family_id, all_clear'),
      supabase.from('families').select('id, timezone'),
    ]);
  if (lockErr) throw new Error(`kid_lock_state read failed: ${lockErr.message}`);
  if (clearErr) throw new Error(`family_all_clear read failed: ${clearErr.message}`);
  if (famErr) throw new Error(`families read failed: ${famErr.message}`);

  return {
    devices: devices || [],
    lockByKid: new Map((locks || []).map((r) => [r.kid_id, r.state])),
    clearByFamily: new Map((clears || []).map((r) => [r.family_id, r.all_clear])),
    tzByFamily: new Map((families || []).map((r) => [r.id, r.timezone])),
  };
}

/**
 * Subscribe to the tables that change lock state. Any change calls onChange
 * (debounced by the caller). Realtime is only a nudge; the poll backstop is
 * what guarantees correctness, so a failed subscription is non-fatal.
 */
export function subscribe(supabase, onChange) {
  const channel = supabase.channel('chorelock-agent');
  for (const table of ['chore_instances', 'kids', 'devices', 'side_quests', 'reward_claims']) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      log.debug(`realtime: ${table} ${payload.eventType}`);
      onChange();
    });
  }
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') log.info('Realtime subscribed (nudge on lock-state changes).');
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      log.warn(`Realtime ${status}; relying on the ${'poll'} backstop.`);
    }
  });
  return channel;
}
