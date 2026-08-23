/**
 * Sign in with Apple.
 *  - Native iOS: Apple's system sheet via @capacitor-community/apple-sign-in, then the
 *    identity token is exchanged with Supabase (signInWithIdToken). No browser redirect.
 *  - Web: standard Supabase OAuth redirect.
 *
 * Supabase: Authentication → Providers → Apple must list BOTH the app bundle id
 * (app.chorelock) for native and the Services ID (app.chorelock.web) for web.
 */
import { Capacitor } from '@capacitor/core';
import { SignInWithApple } from '@capacitor-community/apple-sign-in';
import { supabase } from './supabase';

function nonce() {
  const a = new Uint8Array(16); crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signInWithApple() {
  const sb = supabase!;
  if (Capacitor.getPlatform() === 'ios') {
    const raw = nonce();
    const res = await SignInWithApple.authorize({
      clientId: 'app.chorelock',
      redirectURI: 'https://qkjpxrzbzxxjevxrgfgd.supabase.co/auth/v1/callback',
      scopes: 'email name',
      nonce: await sha256(raw),
    });
    const { error } = await sb.auth.signInWithIdToken({ provider: 'apple', token: res.response.identityToken, nonce: raw });
    if (error) throw error;
    return;
  }
  const { error } = await sb.auth.signInWithOAuth({ provider: 'apple', options: { redirectTo: window.location.origin } });
  if (error) throw error;
}
