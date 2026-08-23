# Handoff: ChoreLock — Family Chore Tracker

## Overview
ChoreLock is a mobile-first web app where kids earn daily Wi-Fi access by completing chores with photo proof. Parents assign chores, review photo submissions, and can manually lock/unlock Wi-Fi per kid (via router integration / MAC-address blocking). This handoff covers all six core screens, empty/loading/error states for Kid Home and Approval Queue, dark mode for the two primary screens, a tablet Parent Dashboard, and a component kit.

## About the Design Files
`ChoreLock Screens.dc.html` is a **design reference created in HTML** — a static artboard canvas showing intended look and behavior, not production code. The task is to **recreate these designs in the target codebase's environment** (React, Vue, native, etc.) using its established patterns — or, if starting fresh, pick an appropriate stack (e.g. React + Tailwind, PWA with camera access via `getUserMedia`).

## Fidelity
**High-fidelity.** Colors, typography, spacing, and copy are final intent. Recreate pixel-close. Photos are placeholders (diagonal-stripe blocks) — replace with real camera captures.

## Product model
- Roles: Parent (admin) and Kid. One app; role chosen at login. Separate experiences, no in-app role switcher.
- A kid's Wi-Fi unlocks when **all required chores for today are Approved**. Bonus chores never affect Wi-Fi.
- Streak = consecutive days with all required chores approved.
- Chore statuses: To do → Submitted → Approved | Rejected (rejected returns to submittable with the parent's reason shown).
- Photo proof is a **live camera capture only** — no gallery upload.
- Everything resets at a configurable daily reset time (default 12:00 AM).
- Sample family used in mocks: Tenleigh (15), Taegyn (13), Dawson (9).

## Screens
Artboards are 390×844 (phone) unless noted. IDs refer to artboards in the design file.

### 1a / 1b — Kid Home (locked / unlocked)
Purpose: kid sees Wi-Fi status, today's chores, streak.
Layout, top to bottom (20px side padding, vertical rhythm ~14px):
1. Header row: uppercase date (700 12px, letter-spacing .08em, #6E6A63) + 36px avatar circle (accent bg, initial).
2. Greeting: Bricolage Grotesque 800, 28px ("Let's do this, Dawson!" / "Nice work, Tenleigh!").
3. **Wi-Fi banner** (the unmissable element): full-width solid card, radius 20px, padding 18px, white text; 34px wifi/lock icon + title (Bricolage 800 23px) + subline (600 14px, 90% opacity).
   - Locked: bg #E5541E, "Wi-Fi Locked 🔒" / "Unlocks when all your chores are approved"
   - Unlocked: bg #1F9D5B, "Wi-Fi Unlocked ✅" / "You're all set until midnight. Enjoy!"
4. Stats row (gap 12): progress-ring card (flex 1) + streak card (118px). White cards, border #E8E5DF, radius 18px, padding 14px.
   - Ring: 66px SVG, track #E8E5DF, fill accent (#5B5BD6) or green when 100%, stroke 9, rounded caps, "1/4" centered (800 16px).
   - Streak: "🔥 5" (800 22px) + "day streak — don't break it!" (700 12.5px #6E6A63).
5. Section label "TODAY'S CHORES" (700 13px, uppercase, .06em, #6E6A63).
6. Chore cards (gap 10): white, border #E8E5DF, radius 16px, padding 14px 16px, min-height 56px. Row: emoji icon 22px · title (700 16px) with optional subline · trailing status chip.
   - The next actionable chore gets a 2px accent border and a "📷 Snap it" pill button (accent bg, white, 700 13px, padding 9px 14px) instead of a chip. Tapping any To-do chore opens Chore Submit.
   - Rejected card: bg #FDEDEC, border #F5C6C0, parent's reason quoted in #C0392B (600 12.5px).
   - Bonus section: label "BONUS — EXTRA CREDIT", card bg #FBFAF8 with 1px **dashed** #D8D4CC border, subline "Doesn't affect Wi-Fi".

### 1c — Chore Submit (live camera)
Dark screen (#121110) regardless of theme.
- Top bar: 40px close button (circle, rgba(255,255,255,.14)) + chore name (800 17px white) + instruction subline ("Show the empty dishwasher", 600 12.5px, 60% white).
- Viewfinder: fills remaining height, 12px side margins, radius 20px, with 26px corner-bracket guides (3px, 55% white). Live `getUserMedia` stream; disable gallery picker.
- Bottom: note pill input "Add a note (optional)…" (rgba(255,255,255,.1) bg, radius 99, padding 13px 18px) then controls row: Retake (text) · 78px shutter (white ring 5px + 60px white core) · flip-camera icon.

### 1d — Chore Submit, waiting state
Light screen after submit: back chevron + chore name; centered 250px photo thumbnail (radius 24) with a pulsing 52px accent clock badge overlapping bottom-right (CSS pulse ~1.8s); "Waiting for approval" (Bricolage 800 26px); "Nice snap! We'll ping you the second it's reviewed." (600 15px #6E6A63); "Submitted · 4:32 PM" chip; full-width primary button "Back to my chores".

### 2a–2c — Kid Home states
- **Empty (2a):** header + green unlocked banner ("No chores today — it's all yours"), centered 110px circle (#EEEEFB) with 🏖️, "Day off!" heading, copy reassures streak is safe.
- **Loading (2b):** skeleton blocks mirroring real layout (banner 96px, stats row, 3×64px cards), shimmer = opacity pulse 1.4s with 0.15s stagger, tones #E4E1DA→#ECEAE4; footer caption "Checking your chores…".
- **Error (2c):** neutral gray banner (#5A564F) "Can't check Wi-Fi status / Your last status is still in effect"; centered warning icon in #FDEEE6 circle, "Couldn't load your chores", reassurance about streak, primary "Try again".

### 3a — Parent Dashboard (phone)
- Header: date + "Today" (Bricolage 800 27px) + "2 to review →" pill (accent tint #EEEEFB / #4646C6) linking to Approvals.
- One card per kid (white, radius 18, padding 16): 42px avatar · name (800 17px) + "X of Y approved" (600 13px #6E6A63) · Wi-Fi pill (dot + label; green tint or orange tint).
  - Progress bar: 7px track #EFEDE8, fill green at 100% else accent.
  - Footer row: pending badge ("① pending review", accent) or "Nothing pending" · override button — **Unlock now** (green text #177245, border #BFE3CC) or **Lock now** (red text #B03A2E, border #EAC7C1), 44px tall. Override is instant and requires no approval flow.
- Footer caption: "Chores reset at 12:00 AM · Router connected".
- Bottom tab bar: Today / Approvals (red badge count) / Chores / Settings; active = accent, inactive #8A857C.

### 3b — Approval Queue
One-thumb, one-card-at-a-time stack.
- Header "Approvals" + "1 of 2" counter pill.
- Card: radius 22, shadow 0 8px 24px rgba(0,0,0,.08); photo 392px tall with "4:32 PM" timestamp pill overlaid top-left (rgba(28,27,26,.72)); below: 38px avatar, "Dawson · Feed the dog" (800 16.5px), meta "Required for unlock · 1st try"; kid's note in a quiet quote box (#FBFAF8, border #EFEDE8).
- Next card peeks behind the top card (offset, lower z).
- Hint text: "Swipe right to approve · left to reject". Swipe gestures mirror the buttons.
- Bottom buttons: Reject (outline, 2px #EAC7C1, text #B03A2E, flex 1) · Approve (solid #1F9D5B, flex 1.4) — both 56px tall.

### 3c — Reject reason sheet
Bottom sheet over dimmed queue (rgba(20,19,17,.45)): grab handle; "Why reject it?" (Bricolage 800 22px) + "Dawson sees this next to the chore."; quick-reason chips (Not finished / Photo unclear / Wrong chore / Redo it, please — selected chip inverts to #1C1B1A/white); optional note field; Cancel + "Send back" (solid #B03A2E) buttons. The reason surfaces on the kid's rejected chore card.

### 3d — Chore Setup (new chore)
Modal-style: Cancel / "New chore" / Save header.
- Chore name: text field (white, 2px accent border when focused, radius 14) with emoji icon.
- Assign to: multi-select avatar chips; selected = #1C1B1A bg white text + "✓", unselected = white with #E0DDD6 border.
- Repeats: segmented control (Daily / Weekdays / Custom) in #ECEAE4 track, selected segment white with shadow; Custom reveals 7 day circles (42px; selected = accent bg white).
- Toggle cards: "Required for Wi-Fi unlock" (subline: "Off = bonus chore. Bonus chores never block Wi-Fi.") and "Photo proof" — 52×31px switches, on = #1F9D5B.
- Full-width primary "Save chore" pinned at bottom.

### 3e — Devices & Settings
- Router status card: green icon tile, "Router connected", "TP-Link Archer AX55 · last check 2 min ago", green status dot.
- "KID DEVICES" group card: rows of avatar + device name (700 15px) + MAC in monospace 12px #8A857C + Online/Blocked chip; "+ Add a device" row in accent. Adding a device = name + MAC.
- "RULES" group card: "Daily reset time" row (value "12:00 AM" in accent, chevron → time picker) and "Auto-approve photos" toggle (default off; subline "Skip review — unlock on submission").

### 4a–4c — Approval Queue states
- **Empty:** green check circle, "All caught up", "New photo submissions land here. Today: 6 approved, 1 sent back.", secondary button "Review today's history".
- **Loading:** skeleton of the card (392px photo block + avatar/text bars) + skeleton action buttons, same shimmer as kid loading.
- **Error:** warning icon, "Couldn't load submissions", "2 photos are waiting. Check your connection — nothing was lost.", primary "Try again".

### 5a / 5b — Dark mode
Same layouts; token swaps only (see Design Tokens). Status banner colors stay saturated (locked bg darkens slightly to #D14A16); chips move to dark tint pairs; accent lightens to #6B6BE0 (fills) / #8583EA (strokes/active).

### 6a — Parent Dashboard, tablet/desktop (1112×740)
- Left sidebar 216px (white, right border): logo, nav (Today active in #EEEEFB tint, Approvals with badge, Chores, Settings), router-status chip pinned to bottom.
- Main: header row; 3-column grid of kid cards (same anatomy as phone plus "View chores" secondary button and age subline); "PENDING APPROVALS" section — 2-column mini approval rows (74px photo thumb, name·chore, time, inline 40px reject/approve icon buttons) with "Open queue →" link; "THIS WEEK" summary bar (86% chores approved, 5-day mini bar chart in #DBDAF5 with current day accent, 🔥 3 active streaks).

## Interactions & Behavior
- Kid taps a To-do/Rejected chore → Chore Submit camera → capture → optional note → submit → waiting state → status chip becomes Submitted.
- Approval/rejection push-notifies the kid; when the last required chore is approved, the banner flips to green (celebrate — a brief confetti/scale-in is appropriate) and router unblocks the kid's devices.
- Parent Approve/Reject via buttons or swipe (right = approve, left = reject → reason sheet). Advancing the stack should feel instant (<150ms card transition).
- Lock now / Unlock now: immediate router override; reflect state in pill without page reload. Consider a confirm on "Lock now" only.
- Skeletons on load (see 2b/4b); pulsing animation ≈1.4–1.8s ease-in-out.
- Auto-approve toggle: when on, submissions skip the queue and approve instantly.
- Errors are non-destructive: keep last-known Wi-Fi state, preserve queue contents, always offer Retry.

## State Management
- Session: role (parent/kid), current kid identity.
- Kid: today's chores [{id, name, emoji, status, required, rejectionReason?, submittedAt?}], wifiState (locked/unlocked/unknown), streakDays, ring progress = approvedRequired/totalRequired.
- Parent: kids [{name, age, avatarColor, wifiState, approvedCount, requiredCount, pendingCount}], approval queue [{photo, kidId, choreId, time, note, attempt}], settings {resetTime, autoApprove, routerStatus, devices[{kidId, name, mac, online/blocked}]}.
- Data: fetch chores/queue on mount; optimistic updates on approve/reject/override; websocket or polling for kid's status flip.

## Design Tokens
Light:
- Background #F6F5F2 · Card #FFFFFF · Subtle card #FBFAF8 · Border #E8E5DF (subtle #EFEDE8, strong #E0DDD6, dashed #D8D4CC)
- Ink #1C1B1A · Secondary #6E6A63 · Tertiary #8A857C
- Accent #5B5BD6 (deep #4646C6, tint bg #EEEEFB, bar-muted #DBDAF5)
- Unlocked/success #1F9D5B (text-on-tint #177245, tint #E6F6EC, border #BFE3CC)
- Locked/warning #E5541E (text-on-tint #B4451B, tint #FDEEE6)
- Rejected/danger #B03A2E (alt #C0392B, tint #FADBD8, card tint #FDEDEC, border #F5C6C0/#EAC7C1)
- Bonus #8A6D1A on #FBF3D9 · Neutral/unknown banner #5A564F

Dark:
- Background #161513 · Card #211F1C · Border #34322D · Ink #F2F0EC · Secondary #A29D94
- Accent fill #6B6BE0, stroke/active #8583EA, tint #26264A/#A5A4F0
- Success #2FB56B, tint #153826/#5DC389 · Locked banner #D14A16, tint #3A2118/#F0A283 · Danger tint #4A2420/#F0968A, card #2A1B16

Typography: **Bricolage Grotesque** 800 for display/headings (19–28px); **Figtree** 400–800 for everything else. Body 14–16px, chips 12px, section labels 12–13px uppercase +.06em. Google Fonts.

Spacing & shape: 20px screen padding; card radius 16–20px (approval card 22, buttons 12–16, chips/pills full round); gaps 10–14px; min tap target 44px (shutter 78px, action buttons 56px).

Kid avatar colors: Tenleigh #0D9488, Taegyn #B45309, Dawson #5B5BD6.

## Assets
No external assets. Icons are inline SVG (24px grid, stroke 2–2.4, round caps): wifi, wifi-lock, wifi-off, camera, check, x, chevron, warning, home, checklist, list, gear, router. Chore icons are emoji. Photo areas in mocks are striped placeholders.

## Files
- `ChoreLock Screens.dc.html` — all artboards on one canvas. IDs: 1a–1d kid screens, 2a–2c kid states, 3a–3e parent screens, 4a–4c queue states, 5a–5b dark mode, 6a tablet, 7a component sheet.
