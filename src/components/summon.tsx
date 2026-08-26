/**
 * Full-screen takeover shown on the kid's device while a summon is active.
 * Beeps + vibrates on a loop (best effort — WebAudio may need a prior gesture)
 * until the kid taps "On my way!", the parent cancels, or the summon expires.
 * Rendered once at the routes level so it covers every kid screen.
 */
import { useEffect, useRef, useState } from 'react';
import { activeSummon, useStore } from '../lib/store';

function useDing(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const ctx = Ctor ? new Ctor() : null;
    const ding = () => {
      navigator.vibrate?.([300, 100, 300]);
      if (!ctx) return;
      void ctx.resume().catch(() => {});
      [880, 1174.66].forEach((freq, n) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = freq;
        const t = ctx.currentTime + n * 0.18;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.start(t); o.stop(t + 0.55);
      });
    };
    ding();
    const iv = setInterval(ding, 2000);
    return () => { clearInterval(iv); void ctx?.close().catch(() => {}); };
  }, [enabled]);
}

export default function SummonOverlay() {
  const s = useStore();
  // A minute pulse so an expired summon drops off even with no data change.
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);
  const summon = s.role === 'kid' && s.currentKidId ? activeSummon(s.summons, s.currentKidId) : undefined;
  const [acking, setAcking] = useState(false);
  const ackedId = useRef<string | null>(null);
  useDing(!!summon && !acking);
  if (!summon || ackedId.current === summon.id) return null;

  const ack = () => {
    setAcking(true);
    ackedId.current = summon.id;
    s.ackSummon(summon.id);
    setTimeout(() => setAcking(false), 400);
  };

  return (
    <div className="summon-overlay">
      <span className="summon-icon" aria-hidden>📢</span>
      <h1 style={{ color: '#fff', fontSize: 30, textAlign: 'center' }}>
        {summon.meeting ? 'Family meeting!' : 'You’re needed!'}
      </h1>
      <p className="summon-where">{summon.meeting ? `Everyone to the ${summon.location}` : `Come to the ${summon.location}`}</p>
      {summon.note && <p className="summon-note">“{summon.note}”</p>}
      <button className="btn btn--lg summon-ack" onClick={ack}>👍 On my way!</button>
      <p className="summon-hint">This keeps dinging until you tap the button.</p>
    </div>
  );
}
