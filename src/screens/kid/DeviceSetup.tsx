import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Icon } from '../../components/ui';
import ScreenTime, { applyLockState } from '../../native/screenTime';
import { useStore } from '../../lib/store';

/**
 * Parent-gated Screen Time setup on the KID's device. Apple's blocked-apps selection is
 * device-local, so a parent holds the kid's phone, proves themselves with the family's
 * parent code (Settings → Parents on their own phone), then authorizes + picks apps here.
 */
export default function DeviceSetup({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [unlocked, setUnlocked] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [st, setSt] = useState<{ authorized: boolean; shielded: boolean } | null>(null);
  const [sel, setSel] = useState<{ appCount: number; categoryCount: number; webDomainCount: number } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!unlocked) return;
    ScreenTime.getStatus().then(setSt).catch(() => {});
    ScreenTime.getSelectionSummary().then(setSel).catch(() => {});
  }, [unlocked]);

  // Prove the shield end-to-end: force it up for 60s, then restore the real state.
  const testShield = async () => {
    setTesting(true);
    await ScreenTime.setShield({ enabled: true, title: 'Shield test 🔒', subtitle: 'ChoreKey is testing app blocking — back in a minute.' }).catch(() => {});
    setSt(await ScreenTime.getStatus().catch(() => null));
    setTimeout(() => {
      void applyLockState(s.currentKidId ? s.kidLockState(s.currentKidId) : 'unlocked');
      setTesting(false);
      void ScreenTime.getStatus().then(setSt).catch(() => {});
    }, 60_000);
  };

  const verify = async () => {
    setBusy(true); setErr(null);
    try {
      const { data, error } = await supabase!.rpc('verify_parent_code', { code: codeInput });
      if (error) throw error;
      if (!data) throw new Error('Wrong code — it’s under Settings → Parents on a parent’s phone.');
      setUnlocked(true);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="handle" />
        {!unlocked ? (
          <>
            <h2 style={{ fontSize: 22 }}>Parents only 🛡️</h2>
            <p style={{ margin: '-8px 0 0', fontWeight: 600, color: 'var(--ink-2)' }}>Enter the parent code to set up app blocking on this device. It’s under Settings → Parents in ChoreKey on a parent’s phone.</p>
            <input className="field mono" style={{ fontSize: 24, textAlign: 'center', letterSpacing: '.3em' }} maxLength={6} autoCapitalize="characters" placeholder="ABC123" value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase())} autoFocus />
            {err && <p className="chore-sub chore-sub--reject">{err}</p>}
            <div className="row">
              <button className="btn btn--outline" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
              <button className="btn btn--primary" style={{ flex: 1.4, width: 'auto' }} disabled={busy || codeInput.length < 6} onClick={verify}>{busy ? 'Checking…' : 'Unlock'}</button>
            </div>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: 22 }}>Screen Time on this device</h2>
            <div className="group">
              <div className="group-row">
                <div className={`status-tile ${st?.authorized ? '' : 'status-tile--off'}`}><Icon.Phone /></div>
                <div className="spacer"><div className="title">Authorization</div><div className="sub">{st?.authorized ? 'Authorized — ChoreKey can shield apps here' : 'Not authorized yet'}</div></div>
                {!st?.authorized && <button className="btn btn--tint" onClick={async () => { try { await ScreenTime.requestAuthorization(); setSt(await ScreenTime.getStatus()); } catch (e) { alert(`Screen Time: ${(e as Error).message ?? e}`); } }}>Authorize</button>}
              </div>
              <button className="group-row" disabled={!st?.authorized} onClick={async () => { try { setSel(await ScreenTime.pickBlockedApps()); setSt(await ScreenTime.getStatus()); } catch (e) { alert(`Screen Time: ${(e as Error).message ?? e}`); } }}>
                <div className="spacer"><div className="title">Blocked while locked</div><div className="sub">{sel && (sel.appCount + sel.categoryCount + sel.webDomainCount) > 0 ? `${sel.appCount} apps · ${sel.categoryCount} categories · ${sel.webDomainCount} sites` : st?.authorized ? 'Choose the apps that lock on this phone' : 'Authorize first'}</div></div>
                <span style={{ color: 'var(--ink-3)' }}><Icon.Chevron /></span>
              </button>
              <div className="group-row">
                <div className="spacer">
                  <div className="title">Shield right now</div>
                  <div className="sub">{st?.shielded ? 'Up — the picked apps should be blocked' : 'Down — apps are open'}{s.currentKidId ? ` · ChoreKey says ${s.kidLockState(s.currentKidId)}` : ''}</div>
                </div>
                <button className="btn btn--tint" disabled={!st?.authorized || testing} onClick={testShield}>{testing ? 'Testing 60s…' : 'Test block'}</button>
              </div>
            </div>
            <p className="hint" style={{ textAlign: 'left', margin: 0 }}>“Test block” shields the picked apps for one minute so you can watch it work, then puts the real state back. Tip: set a Screen Time passcode in iOS Settings so this can’t be undone without you.</p>
            <button className="btn btn--primary" onClick={onClose}>Done</button>
          </>
        )}
      </div>
    </div>
  );
}
