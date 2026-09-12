import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Null when env is missing so the app still boots on the mock store. */
export const supabase = url && key
  ? createClient(url, key, {
      auth: {
        // supabase-js guards token access with navigator.locks. WKWebView suspends the
        // page while the app is backgrounded; if that happens mid-lock, the lock never
        // releases on resume and EVERY query (each one calls getSession) hangs until a
        // force-quit rebuilds the JS context. Observed as "the kid app keeps yesterday's
        // chores after the midnight reset until restarted". One web view, one client —
        // there is nothing to serialise against, so run the callback directly.
        lock: async (_name, _acquireTimeout, fn) => fn(),
      },
    })
  : null;
export const hasBackend = !!supabase;
