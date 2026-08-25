import { useEffect, useState } from 'react';
import { useStore } from '../../lib/store';
import { Avatar, Icon, Switch } from '../../components/ui';
import ScreenTime, { isNativeIOS } from '../../native/screenTime';
import { fmtTime } from './Dashboard';

export default function Settings() {
  const s = useStore();
  const [st, setSt] = useState<{ authorized: boolean; shielded: boolean } | null>(null);
  const [sel, setSel] = useState<{ appCount: number; categoryCount: number; webDomainCount: number } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [devName, setDevName] = useState('');
  const [addingKid, setAddingKid] = useState(false);
  const [savingKid, setSavingKid] = useState(false);
  const [kidName, setKidName] = useState('');
  const [kidAge, setKidAge] = useState('');
  const COLORS = ['#0D9488', '#B45309', '#5B5BD6', '#BE185D', '#1D4ED8', '#15803D'];
  const [devMac, setDevMac] = useState('');

  useEffect(() => { ScreenTime.getStatus().then(setSt); ScreenTime.getSelectionSummary().then(setSel); }, []);

  const routerOk = s.settings.routerStatus === 'connected';

  return (
    <div className="screen">
      <h1>Settings</h1>

      <div className="section-label">Device control</div>
      <div className="group">
        <div className="group-row">
          <div className={`status-tile ${st?.authorized ? '' : 'status-tile--off'}`}><Icon.Phone /></div>
          <div className="spacer"><div className="title">iOS Screen Time</div><div className="sub">{isNativeIOS() ? (st?.authorized ? 'Authorized · shields apps on this device' : 'Not authorized yet') : 'Runs on each kid’s iPhone/iPad'}</div></div>
          {isNativeIOS() && !st?.authorized && <button className="btn btn--tint" onClick={async () => { try { await ScreenTime.requestAuthorization(); setSt(await ScreenTime.getStatus()); } catch (e) { alert(`Screen Time: ${(e as Error).message ?? e}`); } }}>Authorize</button>}
        </div>
        <button className="group-row" onClick={async () => { try { setSel(await ScreenTime.pickBlockedApps()); } catch (e) { alert(`Screen Time: ${(e as Error).message ?? e}`); } }}>
          <div className="spacer"><div className="title">Blocked while locked</div><div className="sub">{sel && (sel.appCount + sel.categoryCount + sel.webDomainCount) > 0 ? `${sel.appCount} apps · ${sel.categoryCount} categories · ${sel.webDomainCount} sites (this device)` : 'Choose apps, categories, or websites'}</div></div>
          <span style={{ color: 'var(--ink-3)' }}><Icon.Chevron /></span>
        </button>
        <div className="group-row">
          <div className={`status-tile ${routerOk ? '' : 'status-tile--off'}`}><Icon.Router /></div>
          <div className="spacer"><div className="title">{routerOk ? 'Router connected' : 'Router (optional)'}</div><div className="sub">{s.settings.routerModel ?? 'For consoles, TVs & non-Apple devices'}</div></div>
          <span className={`dot`} style={{ color: routerOk ? 'var(--ok)' : 'var(--ink-3)' }} />
        </div>
      </div>
      <p className="hint" style={{ textAlign: 'left' }}>App blocking is per device. Set it up on each kid’s phone: open ChoreKey there, tap the 🛡️ icon, and enter your parent code.</p>

      {s.settings.parentCode && (
        <>
          <div className="section-label">Parents</div>
          <div className="group">
            <div className="group-row">
              <div className="spacer"><div className="title">Add a co-parent</div><div className="sub">They create their own account and enter this code to join your family with full parent access.</div></div>
              <div style={{ textAlign: 'right' }}><div className="mono" style={{ fontSize: 16, letterSpacing: '.15em', color: 'var(--accent-deep)', fontWeight: 700 }}>{s.settings.parentCode}</div><div className="sub">parent code</div></div>
            </div>
          </div>
        </>
      )}

      <div className="section-label">Kids</div>
      <div className="group">
        {s.kids.map((k) => (
          <div key={k.id} className="group-row">
            <Avatar kid={k} />
            <div className="spacer"><div className="title">{k.name}</div><div className="sub">Age {k.age} · 🔥 {k.streakDays} day streak</div></div>
            {k.joinCode && <div style={{ textAlign: 'right' }}><div className="mono" style={{ fontSize: 16, letterSpacing: '.15em', color: 'var(--accent-deep)', fontWeight: 700 }}>{k.joinCode}</div><div className="sub">join code</div></div>}
            {s.removeKid && <button className="icon-btn" style={{ background: 'var(--danger-tint)', color: 'var(--danger)', width: 34, height: 34 }} aria-label={`Remove ${k.name}`} onClick={() => { if (confirm(`Remove ${k.name}? Their chores, history, and devices are deleted for good.`)) void s.removeKid!(k.id); }}><Icon.X size={18} /></button>}
          </div>
        ))}
        {s.addKid && <button className="group-row" style={{ color: 'var(--accent-deep)', fontWeight: 700 }} onClick={() => { setAddingKid(true); setKidName(''); setKidAge(''); }}>+ Add a kid</button>}
      </div>

      <div className="section-label">Kid devices</div>
      <div className="group">
        {s.kids.map((k) => (
          <div key={k.id}>
            {s.devices.filter((d) => d.kidId === k.id).map((d) => (
              <div key={d.id} className="group-row">
                <Avatar kid={k} size="sm" />
                <div className="spacer"><div className="title">{d.name}</div><div className="mono">{d.platform === 'ios' ? `Screen Time · ${d.identifier}` : d.identifier}</div></div>
                <span className={`chip ${d.blocked ? 'chip--blocked' : 'chip--online'}`}>{d.blocked ? 'Blocked' : 'Online'}</span>
              </div>
            ))}
            <button className="group-row" style={{ color: 'var(--accent-deep)', fontWeight: 700 }} onClick={() => { setAdding(k.id); setDevName(''); setDevMac(''); }}>+ Add a device for {k.name}</button>
          </div>
        ))}
      </div>
      <p className="hint" style={{ textAlign: 'left' }}>iPhones and iPads register themselves when {'{'}kid{'}'} signs into ChoreKey on them. Add other devices by MAC address for router blocking.</p>

      <div className="section-label">Rules</div>
      <div className="group">
        <label className="group-row">
          <div className="spacer"><div className="title">Daily reset time</div><div className="sub">Chores and locks reset every day</div></div>
          <input type="time" value={s.settings.resetTime} onChange={(e) => s.updateSettings({ resetTime: e.target.value })} style={{ border: 0, background: 'none', color: 'var(--accent-deep)', fontWeight: 700 }} />
        </label>
        <div className="group-row">
          <div className="spacer"><div className="title">Auto-approve photos</div><div className="sub">Skip review — unlock on submission</div></div>
          <Switch on={s.settings.autoApprove} onChange={(v) => s.updateSettings({ autoApprove: v })} />
        </div>
      </div>
      <p className="hint">Resets at {fmtTime(s.settings.resetTime)}</p>
      {s.signOut && <button className="btn btn--outline" onClick={() => s.signOut!()}>Sign out</button>}

      {addingKid && (
        <div className="sheet-backdrop" onClick={() => setAddingKid(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="handle" />
            <h2 style={{ fontSize: 22 }}>Add a kid</h2>
            <input className="field" placeholder="Name" value={kidName} onChange={(e) => setKidName(e.target.value)} autoFocus />
            <input className="field" type="number" inputMode="numeric" placeholder="Age" value={kidAge} onChange={(e) => setKidAge(e.target.value)} />
            <div className="row">
              <button className="btn btn--outline" style={{ flex: 1 }} onClick={() => setAddingKid(false)}>Cancel</button>
              <button className="btn btn--primary" style={{ flex: 1.4, width: 'auto' }} disabled={!kidName || savingKid} onClick={async () => { if (savingKid) return; setSavingKid(true); try { await s.addKid!({ name: kidName, age: Number(kidAge) || 0, avatarColor: COLORS[s.kids.length % COLORS.length] }); } finally { setSavingKid(false); setAddingKid(false); } }}>{savingKid ? 'Adding…' : 'Add'}</button>
            </div>
          </div>
        </div>
      )}

      {adding && (
        <div className="sheet-backdrop" onClick={() => setAdding(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="handle" />
            <h2 style={{ fontSize: 22 }}>Add a device</h2>
            <input className="field" placeholder="Device name (e.g. Switch)" value={devName} onChange={(e) => setDevName(e.target.value)} autoFocus />
            <input className="field mono" style={{ fontSize: 15 }} placeholder="MAC address AA:BB:CC:DD:EE:FF" value={devMac} onChange={(e) => setDevMac(e.target.value.toUpperCase())} />
            <div className="row">
              <button className="btn btn--outline" style={{ flex: 1 }} onClick={() => setAdding(null)}>Cancel</button>
              <button className="btn btn--primary" style={{ flex: 1.4, width: 'auto' }} disabled={!devName || !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(devMac)} onClick={() => { s.addDevice({ kidId: adding, name: devName, platform: 'other', identifier: devMac }); setAdding(null); }}>Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
