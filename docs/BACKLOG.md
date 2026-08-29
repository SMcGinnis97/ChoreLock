# ChoreKey backlog

Feature ideas accepted but not yet scheduled into a build round.

## Screen-time visibility (within Apple's privacy rules)

1. **On-device usage report** — DeviceActivityReport extension rendering daily/weekly
   per-app usage charts inside ChoreKey on the kid's device. Real app names, but view-only
   on that phone: the extension is sandboxed with no network, data cannot be synced out.
2. **Night-usage trend alerts ("3am flags")** — DeviceActivityMonitor schedule over a
   parent-set night window (e.g. 12:00–05:00) with usage thresholds on the blocked-apps
   selection. Records token-anonymous events ("a watched app was used ≥N min in the window")
   to the app group; syncs to the parent dashboard on next app wake. Cannot name the app —
   pair with #1 for specifics.
3. **Bed/wake "timecard" (approximate)** — same monitor mechanism: last watched-app activity
   before the night window and first activity after it, as anonymous timestamps ("phone went
   quiet 10:42 PM, active again 6:58 AM"). Syncable since no app identities are involved.
4. **Real sleep tracking (undecided — likely only worthwhile with Apple Watch / Sleep mode)**
   — HealthKit `sleepAnalysis` read on the kid device with consent; unlike Screen Time data,
   HealthKit summaries can be synced to the parent dashboard. Only populated when the kid
   actually uses iPhone Sleep schedule or wears a Watch; iPhone-only gives time-in-bed at best.

## Offline-reliable critical-task lock (native shield scheduling) — BUILT 2026-08-28
(scheduleCriticalLocks in ScreenTimePlugin + chorelock.criticalLock.N handling in the
monitor extension + store.live effect. Kept for design rationale.)

Observed 2026-08-28: a critical follow-up ("bring the dogs back in") passed its lock
threshold, the server flipped kid_lock_state to locked and sent both pushes, but the
iPad kept streaming — the ChoreKey app never woke, so nothing re-applied the shield.
Enforcement today depends on the JS app running (silent pushes are throttled; a
force-quit app gets no background wakes at all).

Fix: schedule the lock moment natively with DeviceActivity, the same mechanism the
ChoreLockMonitor extension already uses for the daily reset and night watch:

- When a critical round fires (app is usually awake from the 'critical' alert push —
  and also on every app open/refresh as a catch-up), write the round's computed lock
  time (due_at + lock_after_min) to the app group and register a DeviceActivity
  schedule for that moment.
- iOS launches the monitor extension at that time — no push, no network, no app
  open — and the extension applies the ManagedSettings shield from app-group state.
- Completion/cancel path stays push-based (shield lifts on next app wake or silent
  push); erring on the locked side is acceptable. Cancel the schedule when the app
  observes the round done.
- Also register the lock-all time (due_at + lock_all_after_min) on every kid device,
  gated by the app-group "am I exempt (away)" flag.

## Other

- Router local agent for non-Apple devices — design in LOCAL_AGENT.md, blocked on the
  ACL enforcement test (see memory/chorelock-router-integration).
- Family Controls distribution request: confirm the filed form referenced bundle
  app.chorelock (user to check Apple's confirmation email).
