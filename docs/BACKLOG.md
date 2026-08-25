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

## Other

- Router local agent for non-Apple devices — design in LOCAL_AGENT.md, blocked on the
  ACL enforcement test (see memory/chorelock-router-integration).
- Family Controls distribution request: confirm the filed form referenced bundle
  app.chorelock (user to check Apple's confirmation email).
