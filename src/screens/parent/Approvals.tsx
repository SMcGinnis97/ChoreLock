import { useRef, useState } from 'react';
import { useStore } from '../../lib/store';
import { Avatar, Icon } from '../../components/ui';
import { FloatPill } from '../../components/feedback';
import { zoomMedia } from '../../components/lightbox';
import { fmtMoney } from '../../lib/store';

const REASONS = ['Not finished', 'Photo unclear', 'Wrong chore', 'Redo it, please'];

type Target = { kind: 'chore' | 'quest'; id: string } | null;

export default function Approvals({ state }: { state?: 'loading' | 'error' }) {
  const s = useStore();
  const queue = s.instances.filter((i) => i.status === 'submitted');
  const questQueue = s.quests.filter((q) => q.status === 'submitted');
  // Every approval is spot-checkable — proof-less chores included, so nothing auto-approves invisibly.
  const approvedToday = s.instances.filter((i) => i.status === 'approved');
  const [rejecting, setRejecting] = useState<Target>(null);
  const [reason, setReason] = useState<string>('');
  const [noteText, setNoteText] = useState('');
  const [keepStreak, setKeepStreak] = useState(true);
  const [dx, setDx] = useState(0);
  const startX = useRef<number | null>(null);
  // Approve feedback: stamp the card / float the points, then commit.
  const [stamped, setStamped] = useState<string | null>(null);
  const [questPill, setQuestPill] = useState<string | null>(null);
  const approveWithStamp = (id: string) => {
    if (stamped) return;
    setStamped(id);
    setTimeout(() => { setStamped(null); s.approve(id); }, 700);
  };
  const approveQuestWithPill = (id: string) => {
    if (questPill) return;
    setQuestPill(id);
    setTimeout(() => { setQuestPill(null); s.reviewQuest(id, true); }, 900);
  };
  const total = queue.length + s.instances.filter((i) => i.status === 'approved' || i.status === 'rejected').length;

  if (state === 'loading')
    return <div className="screen"><h1>Approvals</h1><div className="skel" style={{ height: 392, borderRadius: 22 }} /><div className="skel" style={{ height: 60 }} /><div className="row"><div className="skel" style={{ flex: 1, height: 56 }} /><div className="skel" style={{ flex: 1.4, height: 56 }} /></div></div>;
  if (state === 'error')
    return <div className="screen"><h1>Approvals</h1><div className="empty"><div className="empty-icon empty-icon--warn"><Icon.Warning size={48} /></div><h2>Couldn’t load submissions</h2><p>{queue.length} photos are waiting. Check your connection — nothing was lost.</p><button className="btn btn--primary">Try again</button></div></div>;

  const sendBack = () => {
    if (!rejecting) return;
    const why = [reason, noteText].filter(Boolean).join(' — ');
    if (rejecting.kind === 'chore') s.reject(rejecting.id, why, keepStreak); else s.reviewQuest(rejecting.id, false, why);
    setRejecting(null); setReason(''); setNoteText(''); setKeepStreak(true);
  };

  const RejectSheet = rejecting && (() => {
    const kidName = rejecting.kind === 'chore'
      ? s.kids.find((k) => k.id === s.instances.find((i) => i.id === rejecting.id)?.kidId)?.name
      : s.kids.find((k) => k.id === s.quests.find((q) => q.id === rejecting.id)?.kidId)?.name;
    return (
      <div className="sheet-backdrop" onClick={() => setRejecting(null)}>
        <div className="sheet" onClick={(e) => e.stopPropagation()}>
          <div className="handle" />
          <h2 style={{ fontSize: 22 }}>Why reject it?</h2>
          <p style={{ margin: '-8px 0 0', fontWeight: 600, color: 'var(--ink-2)' }}>{kidName ?? 'The kid'} sees this and gets a notification. The redo needs your approval.</p>
          <div className="reason-chips">{REASONS.map((r) => <button key={r} className={`reason-chip ${reason === r ? 'selected' : ''}`} onClick={() => setReason(r)}>{r}</button>)}</div>
          <textarea className="field" placeholder="Add a note (optional)" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
          {rejecting.kind === 'chore' && (
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div><div style={{ fontWeight: 700 }}>Keep their streak alive 🔥</div><div className="kid-sub">Off = today breaks the streak unless the redo is approved</div></div>
              <div className="seg" style={{ width: 130 }}>
                <button className={keepStreak ? 'active' : ''} onClick={() => setKeepStreak(true)}>Keep</button>
                <button className={!keepStreak ? 'active' : ''} onClick={() => setKeepStreak(false)}>Break</button>
              </div>
            </div>
          )}
          <div className="row">
            <button className="btn btn--outline" style={{ flex: 1 }} onClick={() => setRejecting(null)}>Cancel</button>
            <button className="btn btn--danger-solid" style={{ flex: 1.4 }} disabled={!reason && !noteText} onClick={sendBack}>Send back</button>
          </div>
        </div>
      </div>
    );
  })();

  const QuestSection = questQueue.length > 0 && (
    <>
      <div className="section-label">⭐ Side quest proof</div>
      <div className="col">
        {questQueue.map((q) => {
          const k = s.kids.find((x) => x.id === q.kidId);
          return (
            <div key={q.id} className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="row">
                {k && <Avatar kid={k} />}
                <div className="spacer"><div style={{ fontWeight: 800 }}>{k?.name ?? '?'} · {q.title}</div><div className="kid-sub">{q.cents ? `💵 ${fmtMoney(q.cents)}` : `⭐ ${q.points} pts`} · {q.submittedAt}</div></div>
              </div>
              {q.proofUrl && (q.proofIsVideo
                ? <video src={q.proofUrl} controls playsInline style={{ width: '100%', borderRadius: 12, maxHeight: 260, background: '#000' }} />
                : <img src={q.proofUrl} alt="" style={{ width: '100%', borderRadius: 12, maxHeight: 260, objectFit: 'cover', cursor: 'zoom-in' }} onClick={() => zoomMedia([q.proofUrl])} />)}
              {q.proofNote && <div className="quote">“{q.proofNote}”</div>}
              <div className="row" style={{ position: 'relative' }}>
                {questPill === q.id && <FloatPill text={`+${q.points} ⭐`} />}
                <button className="btn btn--outline-danger" style={{ flex: 1 }} onClick={() => setRejecting({ kind: 'quest', id: q.id })}>Reject</button>
                <button className="btn btn--success" style={{ flex: 1.4 }} onClick={() => approveQuestWithPill(q.id)}>Approve · {q.cents ? `💵 ${fmtMoney(q.cents)}` : `⭐ ${q.points}`}</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );

  const claimQueue = s.rewardClaims.filter((c) => c.status === 'requested');
  const RewardSection = claimQueue.length > 0 && (
    <>
      <div className="section-label">⭐ Reward requests</div>
      <div className="col">
        {claimQueue.map((c) => {
          const r = s.rewards.find((x) => x.id === c.rewardId); const k = s.kids.find((x) => x.id === c.kidId);
          if (!r || !k) return null;
          const afford = k.points >= r.points;
          return (
            <div key={c.id} className="card row" style={{ padding: 12 }}>
              <span className="chore-emoji">{r.emoji}</span>
              <div className="spacer"><div style={{ fontWeight: 800 }}>{k.name} wants: {r.title}</div><div className="kid-sub">⭐ {r.points} pts · {k.name} has {k.points}{afford ? '' : ' — not enough!'}</div></div>
              <button className="btn btn--outline-danger" style={{ borderWidth: 1 }} onClick={() => s.resolveClaim(c.id, false)}>Deny</button>
              <button className="btn btn--success" onClick={() => s.resolveClaim(c.id, true)}>Grant</button>
            </div>
          );
        })}
      </div>
    </>
  );

  const ApprovedSection = approvedToday.length > 0 && (
    <>
      <div className="section-label">Approved today — spot check</div>
      <div className="col">
        {approvedToday.map((i) => {
          const k = s.kids.find((x) => x.id === i.kidId), c = s.chores.find((x) => x.id === i.choreId);
          if (!k || !c) return null;
          const photos = i.photoUrls ?? (i.photoUrl ? [i.photoUrl] : []);
          // Attribution from the record itself, not the current toggle: no reviewer = the automation did it.
          const reviewer = i.reviewedBy ? s.parents.find((p) => p.userId === i.reviewedBy) : undefined;
          const byline = i.reviewedBy ? (reviewer && !reviewer.isMe ? ` · approved by ${reviewer.name ?? 'co-parent'}` : '') : ' · auto-approved';
          return (
            <div key={i.id} className="card row" style={{ padding: 10 }}>
              <div style={{ width: 74, height: 74, borderRadius: 12, overflow: 'hidden', flexShrink: 0, background: 'var(--track)', cursor: photos.length || i.videoUrl ? 'zoom-in' : 'default', position: 'relative', display: 'grid', placeItems: 'center' }} onClick={() => (photos.length || i.videoUrl) && zoomMedia([...photos, i.videoUrl && { src: i.videoUrl, isVideo: true }])}>
                {photos[0] ? <img src={photos[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : i.videoUrl ? <video src={i.videoUrl} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 28 }} aria-hidden>{c.emoji}</span>}
                {photos.length > 1 && <span className="chip chip--todo" style={{ position: 'absolute', right: 2, bottom: 2, padding: '1px 5px', fontSize: 10 }}>+{photos.length - 1}</span>}
              </div>
              <div className="spacer"><div style={{ fontWeight: 800 }}>{k.name} · {c.name}</div><div className="kid-sub">{i.submittedAt ?? 'today'}{byline}{!photos.length && !i.videoUrl ? ' · no proof required' : ''}</div></div>
              <button className="btn btn--outline-danger" style={{ borderWidth: 1 }} onClick={() => setRejecting({ kind: 'chore', id: i.id })}>Reject</button>
            </div>
          );
        })}
      </div>
    </>
  );

  const current = queue[0];
  if (!current) {
    const approved = s.instances.filter((i) => i.status === 'approved').length, back = s.instances.filter((i) => i.status === 'rejected').length;
    return (
      <div className="screen"><h1>Approvals</h1>
        {questQueue.length === 0 && claimQueue.length === 0 && <div className="empty"><div className="empty-icon empty-icon--ok"><Icon.Check size={52} /></div><h2>All caught up</h2><p>New photo submissions land here. Today: {approved} approved, {back} sent back.</p></div>}
        {QuestSection}
        {RewardSection}
        {ApprovedSection}
        {RejectSheet}
      </div>
    );
  }
  const kid = s.kids.find((k) => k.id === current.kidId)!;
  const chore = s.chores.find((c) => c.id === current.choreId)!;
  const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][(n % 10 > 3 || Math.floor(n % 100 / 10) === 1) ? 0 : n % 10]}`;

  const onPointerDown = (e: React.PointerEvent) => { startX.current = e.clientX; };
  const onPointerMove = (e: React.PointerEvent) => { if (startX.current !== null) setDx(e.clientX - startX.current); };
  const onPointerUp = () => {
    if (dx > 110) approveWithStamp(current.id); else if (dx < -110) setRejecting({ kind: 'chore', id: current.id });
    setDx(0); startX.current = null;
  };

  return (
    <div className="screen">
      <div className="row row--between"><h1>Approvals</h1><span className="chip chip--todo">1 of {queue.length}</span></div>
      <div className="approval-card" style={{ transform: `translateX(${dx}px) rotate(${dx / 30}deg)`, transition: startX.current === null ? 'transform .15s' : 'none', touchAction: 'pan-y' }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        {(() => {
          const photos = current.photoUrls ?? (current.photoUrl ? [current.photoUrl] : []);
          return (
            <>
              <div className="approval-photo">
                {photos[0] ? <img src={photos[0]} alt="" draggable={false} style={{ cursor: 'zoom-in' }} onClick={() => { if (Math.abs(dx) < 8) zoomMedia(photos); }} /> : current.videoUrl ? <video src={current.videoUrl} controls autoPlay muted loop playsInline draggable={false} /> : null}
                <span className="timestamp">{current.submittedAt}</span>
                {photos.length > 1 && <span className="chip chip--todo" style={{ position: 'absolute', left: 8, top: 8 }}>{photos.length} photos</span>}
              </div>
              {photos.length > 1 && (
                <div className="row" style={{ gap: 6, overflowX: 'auto', padding: '6px 8px 0' }}>
                  {photos.map((u, n) => <img key={n} src={u} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10, flexShrink: 0, cursor: 'zoom-in' }} onClick={() => zoomMedia(photos, n)} />)}
                </div>
              )}
              {photos.length > 0 && current.videoUrl && <video src={current.videoUrl} controls muted playsInline style={{ width: '100%', maxHeight: 200, background: '#000' }} />}
            </>
          );
        })()}
        <div className="approval-body">
          <div className="row"><Avatar kid={kid} /><div><div className="approval-title">{kid.name} · {chore.name}</div><div className="kid-sub">{chore.required ? 'Required for unlock' : 'Bonus chore'} · {ordinal(current.attempt)} try</div></div></div>
          {current.note && <div className="quote">“{current.note}”</div>}
        </div>
        {stamped === current.id && <div className="stamp">APPROVED ✓</div>}
      </div>
      {queue.length > 1 && <div className="stack-peek" />}
      <p className="hint">Swipe right to approve · left to reject</p>
      <div className="row">
        <button className="btn btn--outline-danger btn--lg" style={{ flex: 1 }} disabled={!!stamped} onClick={() => setRejecting({ kind: 'chore', id: current.id })}>Reject</button>
        <button className="btn btn--success btn--lg" style={{ flex: 1.4 }} disabled={!!stamped} onClick={() => approveWithStamp(current.id)}>Approve</button>
      </div>
      <p className="hint" style={{ opacity: .6 }}>{total} submissions today</p>

      {QuestSection}
      {RewardSection}
      {ApprovedSection}
      {RejectSheet}
    </div>
  );
}
