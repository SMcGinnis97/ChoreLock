import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { signInWithApple } from '../lib/appleAuth';

type Mode = 'pick' | 'parent-in' | 'parent-up' | 'kid' | 'setup';

/** Entry for live mode: parent email/password, or kid join code (anonymous session). */
export default function Auth({ onDone, needsFamily }: { onDone: () => Promise<void>; needsFamily?: boolean }) {
  const [mode, setMode] = useState<Mode>(needsFamily ? 'setup' : 'pick');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [family, setFamily] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sb = supabase!;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); await onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const signIn = () => run(async () => { const { error } = await sb.auth.signInWithPassword({ email, password: pw }); if (error) throw error; });
  const signUp = () => run(async () => {
    const { data, error } = await sb.auth.signUp({ email, password: pw });
    if (error) throw error;
    if (!data.session) throw new Error('Check your email to confirm, then sign in.');
    const { error: fe } = await sb.rpc('create_family', { family_name: family || `${name}'s family`, parent_name: name });
    if (fe) throw fe;
  });
  const apple = () => run(async () => { await signInWithApple(); });
  const finishSetup = () => run(async () => {
    const { error: fe } = await sb.rpc('create_family', { family_name: family || `${name}'s family`, parent_name: name });
    if (fe) throw fe;
  });
  const joinKid = () => run(async () => {
    const { data: s } = await sb.auth.getSession();
    if (!s.session) { const { error } = await sb.auth.signInAnonymously(); if (error) throw error; }
    const { error } = await sb.rpc('join_as_kid', { code });
    if (error) throw error;
  });

  const Head = (
    <>
      <div style={{ fontSize: 56, textAlign: 'center' }}>🔒</div>
      <h1 style={{ textAlign: 'center' }}>ChoreKey</h1>
    </>
  );

  if (mode === 'pick')
    return (
      <div className="screen screen--center" style={{ gap: 18 }}>
        {Head}
        <p style={{ margin: 0, textAlign: 'center', fontWeight: 600, color: 'var(--ink-2)' }}>Chores first. Then the good stuff.</p>
        <button className="btn btn--primary" onClick={() => setMode('kid')}>I’m a kid — enter my code</button>
        <button className="btn btn--outline btn--lg" onClick={() => setMode('parent-in')}>I’m a parent</button>
      </div>
    );

  if (mode === 'setup')
    return (
      <div className="screen screen--center" style={{ gap: 12 }}>
        {Head}
        <div className="section-label">Almost there — name your family</div>
        <input className="field" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <input className="field" placeholder="Family name (optional)" value={family} onChange={(e) => setFamily(e.target.value)} />
        {err && <p className="chore-sub chore-sub--reject">{err}</p>}
        <button className="btn btn--primary" disabled={busy || !name} onClick={finishSetup}>{busy ? 'One sec…' : 'Create family'}</button>
        <button className="btn btn--text" onClick={() => run(async () => { await sb.auth.signOut(); })}>Sign out</button>
      </div>
    );

  if (mode === 'kid')
    return (
      <div className="screen screen--center" style={{ gap: 14 }}>
        {Head}
        <div className="section-label">Your join code</div>
        <p style={{ margin: 0, fontWeight: 600, color: 'var(--ink-2)' }}>Ask a parent — it’s in their Settings next to your name.</p>
        <input className="field mono" style={{ fontSize: 28, textAlign: 'center', letterSpacing: '.3em' }} maxLength={6} autoCapitalize="characters" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC123" />
        {err && <p className="chore-sub chore-sub--reject">{err}</p>}
        <button className="btn btn--primary" disabled={busy || code.length < 6} onClick={joinKid}>{busy ? 'Joining…' : 'Join'}</button>
        <button className="btn btn--text" onClick={() => setMode('pick')}>Back</button>
      </div>
    );

  const up = mode === 'parent-up';
  return (
    <div className="screen screen--center" style={{ gap: 12 }}>
      {Head}
      <div className="section-label">{up ? 'Create your family' : 'Parent sign in'}</div>
      {up && <input className="field" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />}
      {up && <input className="field" placeholder="Family name (optional)" value={family} onChange={(e) => setFamily(e.target.value)} />}
      <input className="field" type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="field" type="password" placeholder="Password" autoComplete={up ? 'new-password' : 'current-password'} value={pw} onChange={(e) => setPw(e.target.value)} />
      {err && <p className="chore-sub chore-sub--reject">{err}</p>}
      <button className="btn btn--primary" disabled={busy || !email || pw.length < 6 || (up && !name)} onClick={up ? signUp : signIn}>{busy ? 'One sec…' : up ? 'Create family' : 'Sign in'}</button>
      <button className="btn btn--lg" style={{ background: 'var(--ink)', color: 'var(--bg)', width: '100%' }} disabled={busy} onClick={apple}> Sign in with Apple</button>
      <button className="btn btn--text" onClick={() => setMode(up ? 'parent-in' : 'parent-up')}>{up ? 'Already have an account? Sign in' : 'New here? Create a family'}</button>
      <button className="btn btn--text" onClick={() => setMode('pick')}>Back</button>
    </div>
  );
}
