# iOS setup (Screen Time integration)

ChoreLock ships as a Capacitor app. The web UI in `src/` is shared; the device-control
layer is a small Swift plugin plus two app extensions in `ios-native/`.

## Targets

| Target | Type | Files |
|---|---|---|
| App | Capacitor host app | `ios-native/ScreenTimePlugin.swift`, `ios-native/App.entitlements` |
| ChoreLockShield | Shield Configuration Extension | `ios-native/ChoreLockShield/ShieldConfigurationExtension.swift` |
| ChoreLockShieldAction | Shield Action Extension | `ios-native/ChoreLockShield/ShieldActionExtension.swift` |

All three share App Group **`group.app.chorelock`** and the Family Controls entitlement.

## One-time Xcode project setup (done once on a Codemagic build or any Mac)

1. `npx cap add ios` and `npx cap sync ios`.
2. Copy `ios-native/ScreenTimePlugin.swift` into `ios/App/App/` and add it to the App target.
3. Register the plugin in `ios/App/App/AppDelegate.swift` — Capacitor 6+ auto-discovers `CAPBridgedPlugin` classes; nothing extra needed. For older versions add `bridge.registerPluginInstance(ScreenTimePlugin())`.
4. File → New → Target → **Shield Configuration Extension**, name `ChoreLockShield`, bundle ID `app.chorelock.ChoreLockShield`. Replace the generated Swift file with ours.
5. File → New → Target → **Shield Action Extension**, name `ChoreLockShieldAction`. Replace the generated file.
6. Signing & Capabilities on all three targets: add **App Groups** (`group.app.chorelock`) and **Family Controls**.
7. Commit the `ios/` directory after this (remove `ios` from `.gitignore`) so Codemagic doesn't need to redo it.

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
