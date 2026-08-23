import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Null when env is missing so the app still boots on the mock store. */
export const supabase = url && key ? createClient(url, key) : null;
export const hasBackend = !!supabase;
