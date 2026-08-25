import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../lib/store';
import { Avatar, LockBanner, Ring, StatusChip, todayLabel } from '../../components/ui';
import { isNativeIOS } from '../../native/screenTime';
import { fmtDue } from '../parent/Chores';
import DeviceSetup from './DeviceSetup';
import type { ChoreInstance } from '../../lib/types';

export default function KidHome({ state }: { state?: 'loading' | 'error' | 'empty' }) {
  const s = useStore();
  const nav = useNavigate();
  const [setupOpen, setSetupOpen] = useState(false);
  const kid = s.kids.find((k) => k.id === s.currentKidId)!;
  const mine = state === 'empty' ? [] : s.instances.filter((i) => i.kidId === kid.id);
  const withChore = (i: ChoreInstance) => ({ i, c: s.chores.find((c) => c.id === i.choreId)! });
  const required = mine.map(withChore).filter((x) => x.c.required);
  const bonus = mine.map(withChore).filter((x) => !x.c.required);
  const lock = state === 'error' ? 'unknown' : state === 'empty' ? 'unlocked' : s.kidLockState(kid.id);
  const progress = s.requiredProgress(kid.id);
  const nextId = required.find((x) => x.i.status === 'todo' || x.i.status === 'rejected')?.i.id;
  const openQuests = state ? [] : s.quests.filter((q) => q.status === 'open');
  const myQuests = state ? [] : s.quests.filter((q) => q.kidId === kid.id && q.status !== 'open' && q.status !== 'approved');

  const Header = (
    <>
      <div className="row row--between">
        <span className="date">{todayLabel()}</span>
        <div className="row" style={{ gap: 10 }}>
          {isNativeIOS() && !state && <button className="icon-btn" style={{ background: 'var(--track)', color: 'var(--ink-3)', width: 36, height: 36 }} aria-label="Device setup (parents)" onClick={() => setSetupOpen(true)}>🛡️</button>}
          <Avatar kid={kid} />
        </div>
      </div>
      {setupOpen && <DeviceSetup onClose={() => setSetupOpen(false)} />}
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

  const away = !!kid.absentUntil;
  const empty = state === 'empty' || (away && mine.length === 0);

  const QuestCards = (openQuests.length > 0 || myQuests.length > 0) && (
    <>
      <div className="section-label">⭐ Side quests — bonus points</div>
      <div className="col">
        {myQuests.map((q) => {
          const actionable = q.status === 'claimed' || q.status === 'rejected';
          return (
            <button key={q.id} className={`card card--chore is-bonus ${q.status === 'rejected' ? 'is-rejected' : ''}`} disabled={!actionable} onClick={() => nav(`/kid/quest/${q.id}`)}>
              <span className="chore-emoji">⭐</span>
              <div className="spacer">
                <div className="chore-title">{q.title}</div>
                {q.status === 'rejected' && q.rejectionReason ? <div className="chore-sub chore-sub--reject">“{q.rejectionReason}”</div> : q.note ? <div className="chore-sub">{q.note}</div> : <div className="chore-sub">Worth {q.points} points</div>}
              </div>
              {actionable ? <span className="btn btn--pill">📷 Snap it</span> : <span className="chip chip--submitted">Submitted</span>}
            </button>
          );
        })}
        {openQuests.map((q) => (
          <div key={q.id} className="card card--chore is-bonus">
            <span className="chore-emoji">⭐</span>
            <div className="spacer">
              <div className="chore-title">{q.title}</div>
              <div className="chore-sub">{q.note ? `${q.note} · ` : ''}Worth {q.points} points — first to claim it!</div>
            </div>
            <button className="btn btn--pill" onClick={() => s.claimQuest(q.id)}>I got this</button>
          </div>
        ))}
      </div>
    </>
  );

  return (
    <div className="screen">
      {Header}
      <LockBanner state={lock} kidName={kid.name} empty={empty} />

      {empty ? (
        <>
          <div className="empty">
            <div className="empty-icon">🏖️</div>
            <h2>{away ? 'You’re marked away!' : 'Day off!'}</h2>
            <p>{away ? 'No chores while you’re out. ' : 'No chores assigned today. '}Your {kid.streakDays}-day streak is safe.</p>
          </div>
          {QuestCards}
        </>
      ) : (
        <>
          <div className="stats">
            <div className="card ring-card">
              <Ring done={progress.done} total={progress.total} />
              <div><div className="ring-label">Required chores</div><div className="streak-sub">{progress.total - progress.done === 0 ? 'All approved!' : `${progress.total - progress.done} to go`}</div></div>
            </div>
            <div className="card streak-card">
              <div className="streak-num">🔥 {kid.streakDays}</div>
              <div className="streak-sub">day streak</div>
              <div className="streak-sub" style={{ marginTop: 4 }}>⭐ {kid.points} pts</div>
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
                    <div className="chore-title">{c.name}{c.dueTime && (i.status === 'todo' || i.status === 'rejected') ? <span className="chip chip--todo" style={{ marginLeft: 8 }}>due {fmtDue(c.dueTime)}</span> : null}</div>
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

          {QuestCards}
        </>
      )}
    </div>
  );
}
