// Load + validate configuration from environment (.env on this host only).
import 'dotenv/config';
import { setLevel } from './log.js';

function bool(v, dflt) {
  if (v == null || v === '') return dflt;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
}

function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing required env ${name}. Copy .env.example to .env and fill it in.`);
  }
  return v.trim();
}

export function loadConfig() {
  setLevel((process.env.LOG_LEVEL || 'info').trim());

  const cfg = {
    router: {
      host: (process.env.ROUTER_HOST || '192.168.88.1').trim(),
      username: (process.env.ROUTER_USERNAME || 'admin').trim(),
      password: required('ROUTER_PASSWORD'),
      rsaPadding: (process.env.ROUTER_RSA_PADDING || 'none').trim().toLowerCase() === 'pkcs1' ? 'pkcs1' : 'none',
    },
    supabase: {
      url: required('SUPABASE_URL'),
      serviceKey: required('SUPABASE_SERVICE_ROLE_KEY'),
      familyId: (process.env.FAMILY_ID || '').trim() || null,
    },
    pollIntervalMs: Math.max(5, Number(process.env.POLL_INTERVAL_SECONDS) || 30) * 1000,
    dryRun: bool(process.env.DRY_RUN, false),
    scheduleIsAllowedWindow: bool(process.env.SCHEDULE_IS_ALLOWED_WINDOW, false),
  };
  return cfg;
}
