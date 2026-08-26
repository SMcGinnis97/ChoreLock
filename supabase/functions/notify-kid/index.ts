// notify-kid: sends APNs pushes to all iOS devices of one or more kids.
//
// Invoked by DB triggers / pg_cron via pg_net with a service-role bearer.
// Body: { kid_ids: string[], kind: 'reset' | 'state' | 'approved' | 'rejected' | 'grounded' | 'ungrounded', chore?: string, reason?: string }
//   reset/state  -> silent push (content-available) so the app refetches and re-applies the shield
//   approved     -> alert "🎉 {chore} approved" + silent flag
//   rejected     -> alert "{chore} sent back: {reason}"
//   grounded     -> alert "You're grounded" with the parent's reason (+ silent flag so the shield engages)
//   ungrounded   -> alert "You're ungrounded" (+ silent flag)
//   summon       -> time-sensitive alert "chore" = human title ("Come to the Kitchen"), "reason" = note.
//                   Re-sent every 30s by private.ping_summons until acknowledged. Set the APNS_CRITICAL
//                   secret to '1' once Apple grants the Critical Alerts entitlement to also break
//                   through the silent switch at full volume.
//
// Secrets (supabase secrets set ...): APNS_KEY (p8 contents), APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID (app.chorelock),
// APNS_ENV ('sandbox' | 'production').

import { createClient } from 'npm:@supabase/supabase-js@2';

const APNS_KEY = Deno.env.get('APNS_KEY')!;
const APNS_KEY_ID = Deno.env.get('APNS_KEY_ID')!;
const APNS_TEAM_ID = Deno.env.get('APNS_TEAM_ID')!;
const BUNDLE_ID = Deno.env.get('APNS_BUNDLE_ID') ?? 'app.chorelock';
const HOST = Deno.env.get('APNS_ENV') === 'production' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';

const b64url = (b: ArrayBuffer | string) =>
  btoa(typeof b === 'string' ? b : String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let cached: { jwt: string; at: number } | null = null;
async function apnsJwt() {
  const now = Math.floor(Date.now() / 1000);
  if (cached && now - cached.at < 2400) return cached.jwt; // Apple: reuse 20–60 min
  const pem = APNS_KEY.replace(/-----[A-Z ]+-----|\s/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const h = b64url(JSON.stringify({ alg: 'ES256', kid: APNS_KEY_ID }));
  const p = b64url(JSON.stringify({ iss: APNS_TEAM_ID, iat: now }));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${h}.${p}`));
  cached = { jwt: `${h}.${p}.${b64url(sig)}`, at: now };
  return cached.jwt;
}

async function send(token: string, payload: Record<string, unknown>, silent: boolean) {
  const res = await fetch(`${HOST}/3/device/${token}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${await apnsJwt()}`,
      'apns-topic': BUNDLE_ID,
      'apns-push-type': silent ? 'background' : 'alert',
      'apns-priority': silent ? '5' : '10',
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: res.status === 200 ? '' : await res.text() };
}

Deno.serve(async (req) => {
  // Gateway (verify_jwt) already validated the signature; require the service_role claim.
  const tok = (req.headers.get('authorization') ?? '').replace(/^Bearer /i, '');
  let role = '';
  try { role = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role; } catch { /* fallthrough */ }
  if (role !== 'service_role') return new Response('unauthorized', { status: 401 });
  const { kid_ids, kind, chore, reason } = await req.json();
  if (!Array.isArray(kid_ids) || kid_ids.length === 0) return Response.json({ sent: 0 });

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: devices } = await sb.from('devices').select('id, push_token').in('kid_id', kid_ids).eq('platform', 'ios').not('push_token', 'is', null);

  const silent = kind === 'reset' || kind === 'state';
  const alert =
    kind === 'approved' ? { title: '🎉 Approved!', body: `${chore} is done. Nice work.` }
    : kind === 'grounded' ? { title: 'You’re grounded 😔', body: reason ? `${reason} — Wi-Fi is off until it’s lifted.` : 'Wi-Fi is off until it’s lifted. Ask your parent why.' }
    : kind === 'ungrounded' ? { title: 'You’re ungrounded 🎉', body: 'Wi-Fi is back — chores still count.' }
    : kind === 'summon' ? { title: `📢 ${chore}`, body: reason ?? 'It keeps dinging until you tap “On my way!” in ChoreKey.' }
    : { title: 'Sent back', body: `${chore}: ${reason ?? 'take another look'}` };
  const sound = kind === 'summon' && Deno.env.get('APNS_CRITICAL') === '1'
    ? { critical: 1, name: 'default', volume: 1.0 } // needs the Critical Alerts entitlement
    : 'default';
  const payload = silent
    ? { aps: { 'content-available': 1 }, kind }
    : { aps: { alert, sound, 'content-available': 1, ...(kind === 'summon' && { 'interruption-level': 'time-sensitive', 'relevance-score': 1 }) }, kind };

  const results = await Promise.all((devices ?? []).map(async (d) => {
    const r = await send(d.push_token!, payload, silent);
    if (r.status === 410 || r.body.includes('BadDeviceToken') || r.body.includes('Unregistered')) await sb.from('devices').update({ push_token: null }).eq('id', d.id);
    return r.status;
  }));
  return Response.json({ sent: results.filter((s) => s === 200).length, total: results.length });
});
