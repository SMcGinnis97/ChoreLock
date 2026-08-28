import { useEffect, useState } from 'react';
import { balanceCents, fmtMoney, useStore } from '../../lib/store';
import { Avatar, Icon, Switch } from '../../components/ui';
import ScreenTime, { isNativeIOS } from '../../native/screenTime';
import type { Device, Kid } from '../../lib/types';
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
  const [rewardDraft, setRewardDraft] = useState<{ id?: string; title: string; emoji: string; points: number } | null>(null);

  useEffect(() => { ScreenTime.getStatus().then(setSt); ScreenTime.getSelectionSummary().then(setSel); }, []);

  const routerOk = s.settings.routerStatus === 'connected';

  const DeviceRow = ({ d, kid }: { d: Device; kid?: Kid }) => (
    <div className="group-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div className="row">
        {kid ? <Avatar kid={kid} size="sm" /> : <div className="avatar avatar--sm" style={{ background: 'var(--ink)' }}>📺</div>}
        <div className="spacer"><div className="title">{d.name}</div><div className="mono">{d.platform === 'ios' ? `Screen Time · ${d.identifier}` : d.identifier}</div></div>
        <span className={`chip ${d.blocked ? 'chip--blocked' : 'chip--online'}`}>{d.override === 'unlock' ? 'Forced on' : d.override === 'lock' ? 'Forced off' : d.blocked ? 'Blocked' : 'Online'}</span>
        {s.removeDevice && d.platform === 'other' && <button className="icon-btn" style={{ background: 'var(--danger-tint)', color: 'var(--danger)', width: 30, height: 30 }} aria-label={`Remove ${d.name}`} onClick={() => { if (confirm(`Remove ${d.name}?`)) void s.removeDevice!(d.id); }}><Icon.X size={16} /></button>}
      </div>
      {d.platform === 'other' && (
        <>
          <div className="seg">
            {([[null, 'Follow chores'], ['unlock', 'Force on'], ['lock', 'Force off']] as [Device['override'], string][]).map(([v, label]) => (
              <button key={String(v)} className={(d.override ?? null) === v ? 'active' : ''} onClick={() => s.updateDevice(d.id, { override: v })}>{label}</button>
            ))}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <span className="sub" style={{ flexShrink: 0 }}>Allowed daily</span>
            <input className="field" type="time" style={{ padding: 8 }} value={d.scheduleStart ?? ''} onChange={(e) => s.updateDevice(d.id, { override: d.override, scheduleStart: e.target.value })} />
            <span className="sub">to</span>
            <input className="field" type="time" style={{ padding: 8 }} value={d.scheduleEnd ?? ''} onChange={(e) => s.updateDevice(d.id, { override: d.override, scheduleEnd: e.target.value })} />
            {(d.scheduleStart || d.scheduleEnd) && <button className="btn btn--text" style={{ minHeight: 0 }} onClick={() => s.updateDevice(d.id, { override: d.override, scheduleStart: '', scheduleEnd: '' })}>Clear</button>}
          </div>
        </>
      )}
    </div>
  );

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
            {s.parents.map((p) => (
              <div key={p.userId} className="group-row">
                <div className="avatar" style={{ background: 'var(--ink)' }}>{(p.name ?? p.email ?? '?')[0].toUpperCase()}</div>
                <div className="spacer"><div className="title">{p.name ?? 'Parent'}{p.isMe ? ' (you)' : ''}</div><div className="sub">{p.email ?? 'Signed in with Apple'}</div></div>
              </div>
            ))}
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

      <div className="section-label">⭐ Rewards shop</div>
      <div className="group">
        {s.rewards.map((r) => (
          <div key={r.id} className="group-row">
            <span className="chore-emoji">{r.emoji}</span>
            <div className="spacer"><div className="title">{r.title}</div><div className="sub">⭐ {r.points} points</div></div>
            <button className="btn btn--text" onClick={() => setRewardDraft({ id: r.id, title: r.title, emoji: r.emoji, points: r.points })}>Edit</button>
            <button className="icon-btn" style={{ background: 'var(--danger-tint)', color: 'var(--danger)', width: 30, height: 30 }} onClick={() => { if (confirm(`Remove “${r.title}”?`)) s.deleteReward(r.id); }}><Icon.X size={16} /></button>
          </div>
        ))}
        <button className="group-row" style={{ color: 'var(--accent-deep)', fontWeight: 700 }} onClick={() => setRewardDraft({ title: '', emoji: '🎁', points: 25 })}>+ Add a reward</button>
      </div>
      <p className="hint" style={{ textAlign: 'left' }}>Kids spend side-quest points here. They tap Redeem, you approve it in Approvals.</p>

      <div className="section-label">Kid devices</div>
      <div className="group">
        {s.kids.map((k) => (
          <div key={k.id}>
            {s.devices.filter((d) => d.kidId === k.id).map((d) => <DeviceRow key={d.id} d={d} kid={k} />)}
            <button className="group-row" style={{ color: 'var(--accent-deep)', fontWeight: 700 }} onClick={() => { setAdding(k.id); setDevName(''); setDevMac(''); }}>+ Add a device for {k.name}</button>
          </div>
        ))}
      </div>

      <div className="section-label">Family devices</div>
      <div className="group">
        {s.devices.filter((d) => !d.kidId).map((d) => <DeviceRow key={d.id} d={d} />)}
        <button className="group-row" style={{ color: 'var(--accent-deep)', fontWeight: 700 }} onClick={() => { setAdding('family'); setDevName(''); setDevMac(''); }}>+ Add a shared device (PS5, TV…)</button>
      </div>
      <p className="hint" style={{ textAlign: 'left' }}>Shared devices turn on only after <strong>every</strong> kid’s required chores are approved.</p>
      <p className="hint" style={{ textAlign: 'left' }}>iPhones and iPads register themselves when {'{'}kid{'}'} signs into ChoreKey on them. Add other devices by MAC address for router blocking.</p>

      <div className="section-label">💵 Allowance</div>
      <div className="group">
        <div className="group-row">
          <div className="spacer"><div className="title">Streak bonus</div><div className="sub">Pays automatically every time a streak hits the mark</div></div>
          <Switch on={!!s.settings.streakRewardDays} onChange={(v) => s.updateSettings(v ? { streakRewardDays: 7, streakRewardCents: s.settings.streakRewardCents ?? 500 } : { streakRewardDays: undefined, streakRewardCents: undefined })} />
        </div>
        {!!s.settings.streakRewardDays && (
          <div className="group-row">
            <span className="sub">Every</span>
            <input className="field" type="number" min={2} style={{ width: 64, textAlign: 'center' }} value={s.settings.streakRewardDays}
              onChange={(e) => s.updateSettings({ streakRewardDays: Math.max(2, Number(e.target.value) || 7) })} />
            <span className="sub">days pays $</span>
            <input className="field" type="number" min={0.25} step={0.25} style={{ width: 84, textAlign: 'center' }} value={(s.settings.streakRewardCents ?? 500) / 100}
              onChange={(e) => s.updateSettings({ streakRewardCents: Math.max(25, Math.round(Number(e.target.value || 0) * 100)) })} />
          </div>
        )}
        {s.kids.map((k) => {
          const bal = balanceCents(s.moneyLedger, k.id);
          return (
            <div key={k.id} className="group-row">
              <Avatar kid={k} size="sm" />
              <div className="spacer"><div className="title">{k.name}</div><div className="sub">stash: {fmtMoney(bal)}</div></div>
              {bal > 0 && <button className="btn btn--tint" onClick={() => { if (confirm(`Mark ${fmtMoney(bal)} paid to ${k.name}? This zeroes their stash.`)) s.recordMoney(k.id, -bal, 'payout', 'Paid out'); }}>Mark paid</button>}
            </div>
          );
        })}
      </div>
      <p className="hint" style={{ textAlign: 'left' }}>Side quests can also pay money instead of points — pick 💵 when you drop one. “Mark paid” records the hand-over of real cash.</p>

      <div className="section-label">🌙 Night watch</div>
      <div className="group">
        <div className="group-row">
          <div className="spacer"><div className="title">Watch the night window</div><div className="sub">Kid devices report anonymous flags: blocked-app use at night, first screen use in the morning. Never which app.</div></div>
          <Switch on={!!s.settings.nightStart} onChange={(v) => s.updateSettings(v ? { nightStart: '22:00', nightEnd: '06:00' } : { nightStart: undefined, nightEnd: undefined })} />
        </div>
        {!!s.settings.nightStart && (
          <>
            <div className="group-row">
              <span className="sub">Quiet hours</span>
              <input className="field" type="time" style={{ padding: 8 }} value={s.settings.nightStart} onChange={(e) => s.updateSettings({ nightStart: e.target.value || '22:00' })} />
              <span className="sub">to</span>
              <input className="field" type="time" style={{ padding: 8 }} value={s.settings.nightEnd ?? '06:00'} onChange={(e) => s.updateSettings({ nightEnd: e.target.value || '06:00' })} />
            </div>
            <div className="group-row">
              <span className="sub">Flag after</span>
              <input className="field" type="number" min={5} style={{ width: 72, textAlign: 'center' }} value={s.settings.nightThresholdMin ?? 15}
                onChange={(e) => s.updateSettings({ nightThresholdMin: Math.max(5, Number(e.target.value) || 15) })} />
              <span className="sub">min of watched-app use in the window</span>
            </div>
          </>
        )}
      </div>
      <p className="hint" style={{ textAlign: 'left' }}>Flags show up under Insights → Night watch. Kids can see this is on in their app.</p>

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

      {rewardDraft && (
        <div className="sheet-backdrop" onClick={() => setRewardDraft(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="handle" />
            <h2 style={{ fontSize: 22 }}>{rewardDraft.id ? 'Edit reward' : 'Add a reward'}</h2>
            <div className="row">
              <input className="field" style={{ width: 64, textAlign: 'center', fontSize: 22 }} value={rewardDraft.emoji} onChange={(e) => setRewardDraft({ ...rewardDraft, emoji: e.target.value.trim() ? [...e.target.value.trim()].slice(-2).join('') : rewardDraft.emoji })} />
              <input className="field" placeholder="Ice cream run" value={rewardDraft.title} onChange={(e) => setRewardDraft({ ...rewardDraft, title: e.target.value })} autoFocus />
            </div>
            <div className="row">
              <div className="section-label" style={{ margin: 0 }}>Costs</div>
              <div className="seg" style={{ flex: 1 }}>
                {[25, 50, 100, 200].map((p) => <button key={p} className={rewardDraft.points === p ? 'active' : ''} onClick={() => setRewardDraft({ ...rewardDraft, points: p })}>⭐ {p}</button>)}
              </div>
            </div>
            <input className="field" type="number" inputMode="numeric" placeholder="Or a custom amount" value={rewardDraft.points} onChange={(e) => setRewardDraft({ ...rewardDraft, points: Number(e.target.value) || 0 })} />
            <div className="row">
              <button className="btn btn--outline" style={{ flex: 1 }} onClick={() => setRewardDraft(null)}>Cancel</button>
              <button className="btn btn--primary" style={{ flex: 1.4, width: 'auto' }} disabled={!rewardDraft.title.trim() || rewardDraft.points < 1} onClick={() => { s.saveReward(rewardDraft); setRewardDraft(null); }}>Save</button>
            </div>
          </div>
        </div>
      )}

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
            <h2 style={{ fontSize: 22 }}>{adding === 'family' ? 'Add a shared family device' : 'Add a device'}</h2>
            {adding === 'family' && <p style={{ margin: '-8px 0 0', fontWeight: 600, color: 'var(--ink-2)' }}>Stays off until every kid’s required chores are approved.</p>}
            <input className="field" placeholder="Device name (e.g. Switch)" value={devName} onChange={(e) => setDevName(e.target.value)} autoFocus />
            <input className="field mono" style={{ fontSize: 15 }} placeholder="MAC address AA:BB:CC:DD:EE:FF" value={devMac} onChange={(e) => setDevMac(e.target.value.toUpperCase())} />
            <div className="row">
              <button className="btn btn--outline" style={{ flex: 1 }} onClick={() => setAdding(null)}>Cancel</button>
              <button className="btn btn--primary" style={{ flex: 1.4, width: 'auto' }} disabled={!devName || !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(devMac)} onClick={() => { s.addDevice({ kidId: adding === 'family' ? null : adding, name: devName, platform: 'other', identifier: devMac }); setAdding(null); }}>Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
