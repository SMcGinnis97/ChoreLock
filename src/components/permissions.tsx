/**
 * First-open permissions walkthrough (native kid devices).
 * Every app open re-checks camera / notifications / Screen Time. If anything isn't
 * granted, a sheet lists each with its live enabled/disabled state; one tap requests
 * everything still promptable, and denied items get point-to-Settings guidance.
 * Dismissable for the rest of the launch — it returns next open until all green.
 */
import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Camera } from '@capacitor/camera';
import { PushNotifications } from '@capacitor/push-notifications';
import ScreenTime from '../native/screenTime';
import { useStore } from '../lib/store';

type PermState = 'granted' | 'prompt' | 'denied' | 'unknown';

const chip = (st: PermState) =>
  st === 'granted' ? { label: 'On ✓', color: 'var(--success, #0D9488)' }
  : st === 'denied' ? { label: 'Off ✗', color: 'var(--danger, #C0392B)' }
  : st === 'prompt' ? { label: 'Not asked yet', color: 'var(--ink-3, #888)' }
  : { label: 'Checking…', color: 'var(--ink-3, #888)' };

export default function PermissionsGate() {
  const s = useStore();
  const [cam, setCam] = useState<PermState>('unknown');
  const [notif, setNotif] = useState<PermState>('unknown');
  const [screen, setScreen] = useState<PermState>('unknown');
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('chorekey.permsDismissed') === '1');
  const [busy, setBusy] = useState(false);
  const native = Capacitor.isNativePlatform();

  const check = useCallback(async () => {
    try {
      const c = await Camera.checkPermissions();
      setCam(c.camera === 'granted' || c.camera === 'limited' ? 'granted' : c.camera === 'denied' ? 'denied' : 'prompt');
    } catch { setCam('unknown'); }
    try {
      const n = await PushNotifications.checkPermissions();
      setNotif(n.receive === 'granted' ? 'granted' : n.receive === 'denied' ? 'denied' : 'prompt');
    } catch { setNotif('unknown'); }
    try { setScreen((await ScreenTime.getStatus()).authorized ? 'granted' : 'prompt'); } catch { setScreen('unknown'); }
  }, []);
  useEffect(() => { if (native && s.role === 'kid') void check(); }, [native, s.role, check]);

  if (!native || s.role !== 'kid' || dismissed) return null;
  const pending = [cam, notif].filter((x) => x === 'prompt').length > 0;
  const anyMissing = [cam, notif, screen].some((x) => x === 'prompt' || x === 'denied');
  if (!anyMissing) return null;

  const requestAll = async () => {
    setBusy(true);
    try {
      if (notif === 'prompt') { await PushNotifications.requestPermissions().catch(() => {}); await PushNotifications.register().catch(() => {}); }
      if (cam === 'prompt') await Camera.requestPermissions({ permissions: ['camera'] }).catch(() => {});
    } finally {
      await check();
      setBusy(false);
    }
  };
  const dismiss = () => { sessionStorage.setItem('chorekey.permsDismissed', '1'); setDismissed(true); };

  const rows: { icon: string; title: string; sub: string; st: PermState }[] = [
    { icon: '📷', title: 'Camera', sub: 'Snapping proof a chore is done', st: cam },
    { icon: '🔔', title: 'Notifications', sub: 'Approvals, calls, and Wi-Fi updates', st: notif },
    { icon: '🛡️', title: 'Screen Time', sub: 'A parent sets this up via 🛡️ on your home screen', st: screen },
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,.55)', display: 'grid', placeItems: 'end center', padding: 16 }}>
      <div className="card" style={{ width: 'min(440px, 100%)', display: 'flex', flexDirection: 'column', gap: 12, padding: 20, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Let’s get ChoreKey set up</h2>
        <p style={{ margin: 0, fontWeight: 600, color: 'var(--ink-2)' }}>ChoreKey needs a few permissions to do its job:</p>
        <div className="group">
          {rows.map((r) => (
            <div key={r.title} className="group-row">
              <span style={{ fontSize: 22 }} aria-hidden>{r.icon}</span>
              <div className="spacer">
                <div className="title">{r.title}</div>
                <div className="sub">{r.st === 'denied' ? `Turn on in Settings → ChoreKey → ${r.title}` : r.sub}</div>
              </div>
              <span style={{ fontWeight: 800, fontSize: 13, color: chip(r.st).color, whiteSpace: 'nowrap' }}>{chip(r.st).label}</span>
            </div>
          ))}
        </div>
        {pending
          ? <button className="btn btn--primary" disabled={busy} onClick={requestAll}>{busy ? 'Asking…' : 'Turn them on'}</button>
          : <p className="hint" style={{ margin: 0 }}>Anything “Off” has to be flipped in the iOS Settings app.</p>}
        <button className="btn btn--text" onClick={dismiss}>Not now</button>
      </div>
    </div>
  );
}
