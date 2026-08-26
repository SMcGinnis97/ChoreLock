# ChoreKey Router LAN Agent

An always-on Node process that enforces ChoreKey Wi-Fi locks for **non-Apple /
router-managed devices** (`devices.platform = 'other'`) by reconciling the
TP-Link **HB210 Pro**'s Access Control **deny list** against ChoreKey's Supabase
lock state.

iOS devices stay on Screen Time; this agent is only for the `'other'` devices
(Android / Windows / consoles / smart TVs) whose `identifier` column holds a MAC.

- **Outbound-only.** Talks to Supabase (realtime nudge + 30 s poll) and to the
  router on the LAN. No inbound ports, no router WAN exposure.
- **Reconciliation, not messaging.** Every tick computes the desired deny-list
  from the database and makes the router match. Idempotent; survives router
  reboots, session drops, and agent restarts.
- **Fails open.** If the router is unreachable or the desired state is ambiguous,
  it does **not** block — kids keep their internet. A bug must never trap the
  family off their own Wi-Fi.

## ⚠️ Status: enforcement blocked by a firmware guard (2026-08-26)

**The agent is complete and every operation works against the live HB210 Pro
except the final one — creating a deny rule that actually enforces.** It logs in,
reads/writes the deny list, enables rules, commits the firewall, and toggles the
master ACL, all driven by real Supabase lock state. But this firmware only lets a
deny rule *enforce* (cut WAN) when it carries `X_TP_RuleType=2`, and it **refuses
to grant that field to a scripted session** — the byte-identical request that
succeeds from the interactive web UI is rejected with error **4724** from the
agent (not the wire, field order, priming reads, or TCP connection — verified
exhaustively). It behaves like an anti-automation guard tied to genuine browser
interaction (`isuseractive`).

Result: the agent **fails open** — it computes the correct desired block set and
attempts it, but when the firmware refuses the enforcing rule it logs the reason
and leaves Wi-Fi untouched (kids keep internet) rather than creating a misleading
no-op rule. **iOS/Apple devices are unaffected — they enforce via Screen Time,
the primary mechanism.** Router enforcement of non-Apple devices is paused
pending either a firmware change or the wireless-MAC-filter approach
(`DEV2_WIFI_ACL`, the design doc's fallback — kicks the device off Wi-Fi entirely
instead of just cutting WAN).

## How enforcement is *meant* to work

The HB210's Access Control (Advanced → Security → Access Control, **Deny List**
mode) cuts a device's WAN while it stays associated to Wi-Fi. For a MAC to be
blocked: a deny rule for it exists, is **enabled**, carries **`X_TP_RuleType=2`**
(MAC-match — the firmware-guarded field), is **committed** (`X_TP_SetAlready=1`,
set by a full `DEV2_FIREWALL` write-back), and the **master Access Control toggle
is ON** (`DEV2_FIREWALL.X_TP_EnableACL=1`, mode `X_TP_ACLMode=1`).

The agent owns only rules named `ChoreLock:<mac>`, never touching rules a human
added by hand. It keeps the master toggle ON while any block exists and turns it
**OFF** (restoring the factory-baseline) only when the deny list is completely
empty.

### Protocol notes (all reverse-engineered live — see `src/router.js`)

- Endpoint `POST /cgi_gdpr?9` (the `?9` marker is required; plain `/cgi_gdpr` → 71014).
- JSON wire format, one op per request; op codes `go/gl/gs/so/ao/do/op/cgi`.
- Login name is **`user`** (not `admin`) on this single-admin firmware.
- Auth = an httpOnly `JSESSIONID` cookie (set at login) + a `TokenID` header;
  the transport must use `Connection: keep-alive` or the router returns
  header-less bodies that hide the cookie.
- The web admin is single-session; a fresh login force-takes-over any other
  session, so a human on the router UI briefly interrupts the agent and vice-versa.

## Setup

Node 24 is already installed on the host (`C:\Program Files\nodejs`).

```bash
cd router-agent
npm install
copy .env.example .env      # then edit .env
```

Fill in `.env` (never committed — the root `.gitignore` covers `.env`):

- `ROUTER_PASSWORD` — the router admin web password.
- `SUPABASE_SERVICE_ROLE_KEY` — from the Supabase dashboard
  (Project **ChoreLock** `qkjpxrzbzxxjevxrgfgd` → Settings → API → service_role).
  The service key bypasses RLS so the agent can read the lock-state views; keep
  it on this host only.

`SUPABASE_URL` and `ROUTER_HOST` already default to the right values.

## First: prove the router link (do this before trusting enforcement)

```bash
node bin/selftest.js
```

Logs in and prints the current deny list + master-toggle state (read-only). Then
do a live end-to-end block with a spare device on hand:

```bash
node bin/selftest.js block 02:55:D2:AD:65:9F   # the router-seen MAC of the spare
# -> the spare should stay on Wi-Fi but lose internet. Confirm, then:
node bin/selftest.js restore                   # removes ChoreLock rules, master OFF
```

> iOS/modern devices may present a **randomized private MAC** (first octet `02`).
> Always enroll the MAC the **router** sees (from its Online Devices list), and
> disable "Private Wi-Fi Address / Rotate" on kid devices or a Wi-Fi toggle
> dodges the block.

## Run

```bash
npm start            # long-running reconcile loop
npm run once         # single reconcile then exit (good for cron / testing)
```

Dry run (compute + log the plan, never write to the router): set `DRY_RUN=true`
in `.env`.

## Run at startup (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File .\install-task.ps1
Start-ScheduledTask -TaskName 'ChoreKey Router Agent'
```

This registers a Scheduled Task that launches `run.ps1` at logon and
auto-restarts it on failure. Remove with
`Unregister-ScheduledTask -TaskName 'ChoreKey Router Agent'`.

## Desired-state rules

For each `platform='other'` device the agent decides *blocked* vs *allowed*:

| Owner | Blocked when |
|---|---|
| A kid (`kid_id` set) | that kid is `locked` in `kid_lock_state` |
| The family (`kid_id` null, community device) | `family_all_clear.all_clear` is **false** |

Then, in order of increasing precedence:

- **Schedule** (`schedule_start`/`schedule_end`): treated as a daily **block /
  curfew window** — *inside* it the device is force-blocked (e.g. a 22:00–06:00
  bedtime). Set `SCHEDULE_IS_ALLOWED_WINDOW=true` to instead treat the window as
  an allowed window (block outside it). Overnight windows (start > end) are
  supported; times are evaluated in the family's timezone.
- **Override** (`devices.override`): `'lock'` forces blocked, `'unlock'` forces
  allowed — beating chore state and schedule.

Missing/unknown state is treated as **allowed** (fail open).

## Files

```
src/crypto.js     AES/RSA/MD5 for the cgi_gdpr scheme
src/router.js     HB210 client: login, data-model verbs, deny-list primitives
src/supabase.js   read lock-state views + realtime subscription
src/reconcile.js  compute desired MAC set + idempotent reconcile
src/main.js       the reconcile loop (realtime nudge + poll, fail-open)
bin/selftest.js   live login / deny-list read / block / restore
```

## Scope

Best-effort, HB210-Pro-specific. Aginet firmware updates can move the data-model
OIDs; if a firmware update breaks it, re-run `node bin/selftest.js` and adjust
the OIDs/stacks in `src/router.js`.
