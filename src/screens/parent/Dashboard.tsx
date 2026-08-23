import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../../lib/store';
import { Avatar, Icon, todayLabel } from '../../components/ui';

export default function Dashboard() {
  const s = useStore();
  const nav = useNavigate();
  const pendingFor = (kidId: string) => s.instances.filter((i) => i.kidId === kidId && i.status === 'submitted').length;
  const queue = s.instances.filter((i) => i.status === 'submitted');

  return (
    <div className="screen">
      <div className="row row--between">
        <div><div className="date">{todayLabel()}</div><h1 style={{ fontSize: 27 }}>Today</h1></div>
        {s.pendingCount > 0 && <Link to="/parent/approvals" className="btn btn--tint">{s.pendingCount} to review →</Link>}
      </div>

      <div className="kid-grid">
        {s.kids.map((k) => {
          const p = s.requiredProgress(k.id);
          const lock = s.kidLockState(k.id);
          const pend = pendingFor(k.id);
          const full = p.total > 0 && p.done === p.total;
          return (
            <div key={k.id} className="card kid-card">
              <div className="row">
                <Avatar kid={k} size="lg" />
                <div className="spacer"><div className="kid-name">{k.name}</div><div className="kid-sub">{p.done} of {p.total} approved · age {k.age}</div></div>
                <span className={`wifi-pill ${lock === 'unlocked' ? 'wifi-pill--on' : 'wifi-pill--off'}`}><span className="dot" />{lock === 'unlocked' ? 'Unlocked' : 'Locked'}{k.override ? ' · manual' : ''}</span>
              </div>
              <div className="progress"><div className={full ? 'full' : ''} style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} /></div>
              <div className="row row--between">
                {pend ? <Link to="/parent/approvals" className="pending">① {pend} pending review</Link> : <span className="quiet">Nothing pending</span>}
                {lock === 'unlocked'
                  ? <button className="btn btn--outline-danger" style={{ borderWidth: 1 }} onClick={() => { if (confirm(`Lock ${k.name}’s devices now?`)) s.override(k.id, 'lock'); }}>Lock now</button>
                  : <button className="btn btn--outline-ok" onClick={() => s.override(k.id, 'unlock')}>Unlock now</button>}
              </div>
              {k.override && <button className="btn btn--text" style={{ alignSelf: 'flex-start', minHeight: 0 }} onClick={() => s.override(k.id, null)}>Clear manual override</button>}
            </div>
          );
        })}
      </div>

      {queue.length > 0 && (
        <>
          <div className="row row--between"><span className="section-label">Pending approvals</span><Link to="/parent/approvals">Open queue →</Link></div>
          <div className="col">
            {queue.map((i) => {
              const k = s.kids.find((x) => x.id === i.kidId)!, c = s.chores.find((x) => x.id === i.choreId)!;
              return (
                <div key={i.id} className="card row" style={{ padding: 10 }}>
                  <div style={{ width: 74, height: 74, borderRadius: 12, overflow: 'hidden', flexShrink: 0, background: 'repeating-linear-gradient(135deg,#D8D4CC 0 8px,#E8E5DF 8px 16px)' }}>{i.photoUrl && <img src={i.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}</div>
                  <div className="spacer"><div style={{ fontWeight: 800 }}>{k.name} · {c.name}</div><div className="kid-sub">{i.submittedAt} · attempt {i.attempt}</div></div>
                  <button className="icon-btn" style={{ background: 'var(--danger-tint)', color: 'var(--danger)' }} onClick={() => nav('/parent/approvals')}><Icon.X size={20} /></button>
                  <button className="icon-btn" style={{ background: 'var(--ok-tint)', color: 'var(--ok-text)' }} onClick={() => s.approve(i.id)}><Icon.Check size={20} /></button>
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="hint">Chores reset at {fmtTime(s.settings.resetTime)} · {s.settings.routerStatus === 'connected' ? 'Router connected' : 'On-device control (Screen Time)'}</p>
    </div>
  );
}

export const fmtTime = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); const d = new Date(); d.setHours(h, m); return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
