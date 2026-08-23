# ChoreLock

Kids earn daily app/Wi-Fi access by finishing chores with photo proof. Parents assign, review, and override.

Built from the Claude Design handoff in `docs/DESIGN_HANDOFF.md` (canvas: `docs/design-canvas.dc.html`).

## Stack
- **UI:** Vite + React + TypeScript, plain CSS with the handoff's design tokens (`src/index.css`). No component library.
- **Mobile:** Capacitor (iOS first). Camera via `@capacitor/camera` (live capture only).
- **Device control:** iOS Screen Time (FamilyControls / ManagedSettings) — `src/native/screenTime.ts` + `ios-native/`. See `docs/IOS_SETUP.md`.
- **Backend:** Supabase — schema in `supabase/migrations/0001_init.sql`. The app currently runs on an in-memory mock (`src/lib/store.tsx`) so every screen works without a backend.
- **CI:** Codemagic (`codemagic.yaml`) → TestFlight.

## Run
```bash
npm install
npm run dev
```
Open http://localhost:5173 — pick a kid or the parent dashboard. `/states` previews empty / loading / error screens.

## Status
- [x] All handoff screens implemented (kid home + states, camera submit, waiting, dashboard phone + tablet, approvals + reject sheet + states, chore setup, settings)
- [x] Lock logic (required chores → unlock, bonus ignored, parent override)
- [x] Swift Screen Time plugin + shield extensions (uncompiled — needs Codemagic run)
- [x] Supabase schema
- [ ] Family Controls entitlement — **submit `docs/FAMILY_CONTROLS_REQUEST.md`** (long pole)
- [ ] Wire Supabase client + auth (parent email login; kid join-code)
- [ ] `kid-api` edge function (device registration, lock-state read, photo upload)
- [ ] Daily reset cron + APNs push
- [ ] Xcode project one-time setup on Codemagic, first TestFlight build
- [ ] Optional: TP-Link router integration for non-Apple devices (model TBD)
