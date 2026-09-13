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

## App Store Connect listing — TODO (noted 2026-09-11)

- Critical Alerts entitlement request 9K8N27DQAA was **rejected** 2026-09-11 ("not designed
  for the use you've identified" — reserved for medical/health, home/security, public safety).
  Before any re-request, finish the ASC app record: screenshots, description, keywords,
  privacy details, support URL, TestFlight Test Information. If we re-apply, the summons
  feature would have to be framed as a personal-safety use (e.g. "come home now" /
  emergency family recall) — the plain "chore reminder" framing will not qualify.
- Until then summons/critical pushes play at normal notification volume and respect the
  silent switch; APNS_CRITICAL stays unset.

## Parent notifications — BUILT 2026-09-12 (migration 0029, notify-kid parent mode)

Shipped: `parent_devices` tokens, `family_events` feed (Insights → Family activity, realtime),
`private.notify_parents()` with actor exclusion + per-parent category prefs (Settings →
🔔 Notifications), triggers on chore_instances / side_quests / reward_claims /
unlock_requests / summons / kids / critical_instances / list_items, tap-to-route via the
`chorekey:route` window event in ParentShell.

Follow-ups not yet done:
- Device-verify on a parent iPhone: permission prompt on first parent open, token lands in
  `parent_devices`, a kid "Ask for 15" push arrives time-sensitive and opens Today, an
  approval by one parent reaches the other (and NOT the approver).
- Badge count on the app icon = pending approvals (needs `aps.badge` on parent pushes +
  a clear on open). Not wired.
- Quiet hours for parent pushes (e.g. mute 'approvals' overnight) — prefs are per category
  only today.
- Summons cancel / expiry are silent to co-parents (only the call and the kid's reply notify).
- `handoff_today` (away hand-off) and allowance payouts do not notify co-parents yet.
- Web (non-native) parents get the feed but no pushes; Web Push would need a VAPID path.

## Open todos (as of 2026-09-12, after the parent-notification round)

1. TestFlight build #23 from this commit, then device tests: parent pushes (above), bedtime
   shield now indigo vs grounded slate, bedtime hand-off keys written by push
   (`bedtimeSuppressed` / `bedtimeAfter` in the app group), "See my chores" notification
   from the shield button, post-midnight refresh without force-quit (build #22 fix).
2. Dawson's bedtime is currently 23:00–23:01 in the DB (1-minute test window — locks via
   push, never registers natively). Set a real window (≥15 min) from Settings; the server
   now rejects short windows too.
3. App Store Connect listing (screenshots, description, privacy, support URL, TestFlight
   Test Information) — prerequisite for any Critical Alerts re-request.
4. AdGuard Home DNS enforcement for TVs/consoles — deployment on the home LAN unverified.
5. On-device DeviceActivityReport usage extension (new target + bundle id).
6. Rotate the dev cert private key and APNs/SIWA .p8 keys that were pasted in chats.
7. Dashboard "device last synced" indicator (parked idea).
8. Roadmap after this: calendar (absence integration) → messaging-lite → presence.
