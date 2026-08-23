import { useNavigate } from 'react-router-dom';
import { useStore } from '../../lib/store';
import { Avatar, LockBanner, Ring, StatusChip, todayLabel } from '../../components/ui';
import type { ChoreInstance } from '../../lib/types';

export default function KidHome({ state }: { state?: 'loading' | 'error' | 'empty' }) {
  const s = useStore();
  const nav = useNavigate();
  const kid = s.kids.find((k) => k.id === s.currentKidId)!;
  const mine = state === 'empty' ? [] : s.instances.filter((i) => i.kidId === kid.id);
  const withChore = (i: ChoreInstance) => ({ i, c: s.chores.find((c) => c.id === i.choreId)! });
  const required = mine.map(withChore).filter((x) => x.c.required);
  const bonus = mine.map(withChore).filter((x) => !x.c.required);
  const lock = state === 'error' ? 'unknown' : state === 'empty' ? 'unlocked' : s.kidLockState(kid.id);
  const progress = s.requiredProgress(kid.id);
  const nextId = required.find((x) => x.i.status === 'todo' || x.i.status === 'rejected')?.i.id;

  const Header = (
    <>
      <div className="row row--between"><span className="date">{todayLabel()}</span><Avatar kid={kid} /></div>
      <h1>{lock === 'unlocked' ? `Nice work, ${kid.name}!` : `Let’s do this, ${kid.name}!`}</h1>
    </>
  );

  if (state === 'loading')
    return (
      <div className="screen">
        {Header}
        <div className="skel" style={{ height: 96, borderRadius: 20 }} />
        <div className="stats"><div className="skel" style={{ flex: 1, height: 94 }} /><div className="skel" style={{ width: 118, height: 94 }} /></div>
        <div className="skel" style={{ height: 64 }} /><div className="skel" style={{ height: 64 }} /><div className="skel" style={{ height: 64 }} />
        <p className="hint">Checking your chores…</p>
      </div>
    );

  if (state === 'error')
    return (
      <div className="screen">
        {Header}
        <LockBanner state="unknown" />
        <div className="empty">
          <div className="empty-icon empty-icon--warn"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l10 18H2z" /><path d="M12 10v5" /><circle cx="12" cy="18" r="1" fill="currentColor" /></svg></div>
          <h2>Couldn’t load your chores</h2>
          <p>Your streak is safe — nothing was lost. Check your connection and try again.</p>
          <button className="btn btn--primary" onClick={() => nav('/kid')}>Try again</button>
        </div>
      </div>
    );

  return (
    <div className="screen">
      {Header}
      <LockBanner state={lock} kidName={kid.name} empty={state === 'empty'} />

      {state === 'empty' ? (
        <div className="empty">
          <div className="empty-icon">🏖️</div>
          <h2>Day off!</h2>
          <p>No chores assigned today. Your {kid.streakDays}-day streak is safe.</p>
        </div>
      ) : (
        <>
          <div className="stats">
            <div className="card ring-card">
              <Ring done={progress.done} total={progress.total} />
              <div><div className="ring-label">Required chores</div><div className="streak-sub">{progress.total - progress.done === 0 ? 'All approved!' : `${progress.total - progress.done} to go`}</div></div>
            </div>
            <div className="card streak-card">
              <div className="streak-num">🔥 {kid.streakDays}</div>
              <div className="streak-sub">day streak — don’t break it!</div>
            </div>
          </div>

          <div className="section-label">Today’s chores</div>
          <div className="col">
            {required.map(({ i, c }) => {
              const actionable = i.status === 'todo' || i.status === 'rejected';
              return (
                <button key={i.id} className={`card card--chore ${i.id === nextId ? 'is-next' : ''} ${i.status === 'rejected' ? 'is-rejected' : ''}`} disabled={!actionable} onClick={() => nav(`/kid/submit/${i.id}`)}>
                  <span className="chore-emoji">{c.emoji}</span>
                  <div className="spacer">
                    <div className="chore-title">{c.name}</div>
                    {i.status === 'rejected' && i.rejectionReason && <div className="chore-sub chore-sub--reject">“{i.rejectionReason}”</div>}
                    {i.status === 'todo' && c.instruction && <div className="chore-sub">{c.instruction}</div>}
                  </div>
                  {i.id === nextId ? <span className="btn btn--pill">📷 Snap it</span> : <StatusChip status={i.status} />}
                </button>
              );
            })}
          </div>

          {bonus.length > 0 && (
            <>
              <div className="section-label">Bonus — extra credit</div>
              <div className="col">
                {bonus.map(({ i, c }) => (
                  <button key={i.id} className="card card--chore is-bonus" disabled={i.status !== 'todo' && i.status !== 'rejected'} onClick={() => nav(`/kid/submit/${i.id}`)}>
                    <span className="chore-emoji">{c.emoji}</span>
                    <div className="spacer"><div className="chore-title">{c.name}</div><div className="chore-sub">Doesn’t affect Wi-Fi</div></div>
                    <StatusChip status={i.status} bonus />
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
