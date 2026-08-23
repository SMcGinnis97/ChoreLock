# iOS setup (Screen Time integration)

ChoreLock ships as a Capacitor app. The web UI in `src/` is shared; the device-control
layer is a small Swift plugin plus two app extensions in `ios-native/`.

## Targets

| Target | Type | Files |
|---|---|---|
| App | Capacitor host app | `ios-native/ScreenTimePlugin.swift`, `ios-native/App.entitlements` |
| ChoreLockShield | Shield Configuration Extension | `ios-native/ChoreLockShield/ShieldConfigurationExtension.swift` |
| ChoreLockShieldAction | Shield Action Extension | `ios-native/ChoreLockShield/ShieldActionExtension.swift` |
| ChoreLockMonitor | Device Activity Monitor Extension | `ios-native/ChoreLockMonitor/DeviceActivityMonitorExtension.swift` |

All four share App Group **`group.app.chorelock`** and the Family Controls entitlement.

## Project assembly (automated)

`ios/` is **not** committed. Every Codemagic build regenerates it:
`npx cap add ios` → `npx cap sync ios` → `ruby scripts/ios-setup.rb` (xcodeproj gem), which adds the plugin,
the three extension targets, entitlements, Info.plist keys, team and deployment target. Nothing to do in Xcode.

## Apple portal prerequisites (once)

App IDs, all with **App Groups** (`group.app.chorelock`) + **Family Controls (Development)**:
- `app.chorelock` — also **Push Notifications** and **Sign In with Apple**
- `app.chorelock.ChoreLockShield`
- `app.chorelock.ChoreLockShieldAction`
- `app.chorelock.ChoreLockMonitor`

For the `ios-dev` workflow, register each test iPhone's UDID under **Devices** (Settings → General → About → tap serial… or via Finder/iTunes), then the build's install link works on it.

## Runtime flow on a kid device

```
launch / push / BG refresh
        │
        ▼
GET kid lock state (Supabase view kid_lock_state)
        │
        ▼
applyLockState('locked' | 'unlocked')      ← src/native/screenTime.ts
        │
        ▼
ScreenTime.setShield({enabled})            ← ScreenTimePlugin.swift
        │
        ▼
ManagedSettingsStore.shield.* set/cleared  ← iOS enforces; extension draws block screen
```

- The daily reset is done server-side (cron → new chore_instances + clears overrides) and
  pushed to kid devices via APNs silent push; the device also re-checks on every foreground.
- Multiple devices per kid: each install registers a `devices` row and applies the same state.

## Web/dev

`ScreenTime` resolves to a logging stub on web, so `npm run dev` exercises every screen.

## Push (APNs) — server side

1. Apple Developer → Keys → `+` → **Apple Push Notifications service (APNs)** → download `.p8`, note Key ID. (A separate key from the Sign-in-with-Apple one.)
2. Set edge-function secrets (Supabase dashboard → Edge Functions → notify-kid → Secrets, or CLI):
   `APNS_KEY` (full .p8 contents), `APNS_KEY_ID`, `APNS_TEAM_ID=XTDR638PA7`, `APNS_BUNDLE_ID=app.chorelock`, `APNS_ENV=sandbox` (switch to `production` for TestFlight/App Store builds).
3. Give the database the service-role key so triggers/cron can call the function — run once in the SQL editor:
   `insert into private.config(key,value) values ('service_role_key','<service_role key from Settings → API>') on conflict (key) do update set value = excluded.value;`

Until step 3 is done, `private.notify_kids()` silently no-ops; everything else (reset, approvals) still works — the kid's app just refreshes on next open instead of instantly.

## Daily reset — how it actually works

- **Server:** `private.run_resets()` (pg_cron, every 5 min) materialises today's chore instances for each family once its `reset_time` passes in the family's timezone, clears stale overrides, and silent-pushes all kid devices.
- **Device (offline-safe):** `ScreenTimePlugin.scheduleDailyReset` registers a repeating `DeviceActivitySchedule`; the `ChoreLockMonitor` extension re-applies the shield at reset time even with no network. The next app open / push reconciles with the server (e.g. clears the shield if there are no chores today).
