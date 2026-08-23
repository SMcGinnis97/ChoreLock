import { useRef, useState } from 'react';
import { useStore } from '../../lib/store';
import { Avatar, Icon } from '../../components/ui';

const REASONS = ['Not finished', 'Photo unclear', 'Wrong chore', 'Redo it, please'];

export default function Approvals({ state }: { state?: 'loading' | 'error' }) {
  const s = useStore();
  const queue = s.instances.filter((i) => i.status === 'submitted');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState<string>('');
  const [noteText, setNoteText] = useState('');
  const [dx, setDx] = useState(0);
  const startX = useRef<number | null>(null);
  const total = queue.length + s.instances.filter((i) => i.status === 'approved' || i.status === 'rejected').length;

  if (state === 'loading')
    return <div className="screen"><h1>Approvals</h1><div className="skel" style={{ height: 392, borderRadius: 22 }} /><div className="skel" style={{ height: 60 }} /><div className="row"><div className="skel" style={{ flex: 1, height: 56 }} /><div className="skel" style={{ flex: 1.4, height: 56 }} /></div></div>;
  if (state === 'error')
    return <div className="screen"><h1>Approvals</h1><div className="empty"><div className="empty-icon empty-icon--warn"><Icon.Warning size={48} /></div><h2>Couldn’t load submissions</h2><p>{queue.length} photos are waiting. Check your connection — nothing was lost.</p><button className="btn btn--primary">Try again</button></div></div>;

  const current = queue[0];
  if (!current) {
    const approved = s.instances.filter((i) => i.status === 'approved').length, back = s.instances.filter((i) => i.status === 'rejected').length;
    return (
      <div className="screen"><h1>Approvals</h1>
        <div className="empty"><div className="empty-icon empty-icon--ok"><Icon.Check size={52} /></div><h2>All caught up</h2><p>New photo submissions land here. Today: {approved} approved, {back} sent back.</p><button className="btn btn--outline">Review today’s history</button></div>
      </div>
    );
  }
  const kid = s.kids.find((k) => k.id === current.kidId)!;
  const chore = s.chores.find((c) => c.id === current.choreId)!;
  const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][(n % 10 > 3 || Math.floor(n % 100 / 10) === 1) ? 0 : n % 10]}`;

  const onPointerDown = (e: React.PointerEvent) => { startX.current = e.clientX; };
  const onPointerMove = (e: React.PointerEvent) => { if (startX.current !== null) setDx(e.clientX - startX.current); };
  const onPointerUp = () => {
    if (dx > 110) s.approve(current.id); else if (dx < -110) setRejecting(current.id);
    setDx(0); startX.current = null;
  };
  const sendBack = () => { if (!rejecting) return; s.reject(rejecting, [reason, noteText].filter(Boolean).join(' — ')); setRejecting(null); setReason(''); setNoteText(''); };

  return (
    <div className="screen">
      <div className="row row--between"><h1>Approvals</h1><span className="chip chip--todo">1 of {queue.length}</span></div>
      <div className="approval-card" style={{ transform: `translateX(${dx}px) rotate(${dx / 30}deg)`, transition: startX.current === null ? 'transform .15s' : 'none', touchAction: 'pan-y' }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <div className="approval-photo">{current.photoUrl && <img src={current.photoUrl} alt="" draggable={false} />}<span className="timestamp">{current.submittedAt}</span></div>
        <div className="approval-body">
          <div className="row"><Avatar kid={kid} /><div><div className="approval-title">{kid.name} · {chore.name}</div><div className="kid-sub">{chore.required ? 'Required for unlock' : 'Bonus chore'} · {ordinal(current.attempt)} try</div></div></div>
          {current.note && <div className="quote">“{current.note}”</div>}
        </div>
      </div>
      {queue.length > 1 && <div className="stack-peek" />}
      <p className="hint">Swipe right to approve · left to reject</p>
      <div className="row">
        <button className="btn btn--outline-danger btn--lg" style={{ flex: 1 }} onClick={() => setRejecting(current.id)}>Reject</button>
        <button className="btn btn--success btn--lg" style={{ flex: 1.4 }} onClick={() => s.approve(current.id)}>Approve</button>
      </div>
      <p className="hint" style={{ opacity: .6 }}>{total} submissions today</p>

      {rejecting && (
        <div className="sheet-backdrop" onClick={() => setRejecting(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="handle" />
            <h2 style={{ fontSize: 22 }}>Why reject it?</h2>
            <p style={{ margin: '-8px 0 0', fontWeight: 600, color: 'var(--ink-2)' }}>{kid.name} sees this next to the chore.</p>
            <div className="reason-chips">{REASONS.map((r) => <button key={r} className={`reason-chip ${reason === r ? 'selected' : ''}`} onClick={() => setReason(r)}>{r}</button>)}</div>
            <textarea className="field" placeholder="Add a note (optional)" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
            <div className="row">
              <button className="btn btn--outline" style={{ flex: 1 }} onClick={() => setRejecting(null)}>Cancel</button>
              <button className="btn btn--danger-solid" style={{ flex: 1.4 }} disabled={!reason && !noteText} onClick={sendBack}>Send back</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
