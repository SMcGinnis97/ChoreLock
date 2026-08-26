import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../lib/store';
import { Icon } from '../../components/ui';
import { useHistory, isoDaysAgo } from '../../lib/history';

const DAY_WINDOW = 56; // history window for best-streak + ledger

interface Badge { emoji: string; title: string; sub: string; unlocked: boolean; hint: string }

export default function KidStats() {
  const s = useStore();
  const nav = useNavigate();
  const kid = s.kids.find((k) => k.id === s.currentKidId);
  const { data, loading } = useHistory(DAY_WINDOW, kid ? [kid] : []);

  const view = useMemo(() => {
    if (!data || !kid) return null;
    // Per-day required completion, oldest → newest.
    const dayDone = new Map<string, boolean | null>();
    for (let n = DAY_WINDOW - 1; n >= 0; n--) {
      const date = isoDaysAgo(n);
      const day = data.instances.filter((i) => i.kidId === kid.id && i.date === date && i.required);
      dayDone.set(date, day.length ? day.every((i) => i.status === 'approved') : null);
    }
    // Best streak in the window (days with no chores don't break it).
    let best = 0, run = 0;
    dayDone.forEach((done) => {
      if (done === true) { run++; best = Math.max(best, run); }
      else if (done === false) run = 0;
    });
    best = Math.max(best, kid.streakDays);
    const strip = Array.from({ length: 8 }, (_, n) => {
      const date = isoDaysAgo(7 - n);
      return { done: dayDone.get(date) === true, today: n === 7 };
    });
    // Point ledger: quest earns + granted reward spends, newest first.
    const ledger = [
      ...data.quests.filter((q) => q.kidId === kid.id && q.status === 'approved').map((q) => ({ title: q.title, sub: 'side quest', when: q.reviewedAt, amt: q.points })),
      ...data.claims.filter((c) => c.kidId === kid.id && c.status === 'granted').map((c) => ({ title: c.title, sub: 'reward', when: c.resolvedAt, amt: -c.points })),
    ].sort((a, b) => (b.when ?? '').localeCompare(a.when ?? '')).slice(0, 8);
    const questsApproved = data.quests.filter((q) => q.kidId === kid.id && q.status === 'approved').length;
    const anyApproved = data.instances.some((i) => i.kidId === kid.id && i.status === 'approved');
    const badges: Badge[] = [
      { emoji: '🧹', title: 'First chore', sub: 'Get one chore approved', unlocked: anyApproved || kid.streakDays > 0, hint: 'get your first chore approved' },
      { emoji: '🔥', title: 'Week warrior', sub: '7-day streak', unlocked: best >= 7, hint: `keep the streak going ${Math.max(0, 7 - kid.streakDays)} more days` },
      { emoji: '⭐', title: 'Quest hunter', sub: '5 side quests done', unlocked: questsApproved >= 5, hint: `finish ${Math.max(0, 5 - questsApproved)} more side quests` },
    ];
    return { best, strip, ledger, badges };
  }, [data, kid]);

  if (!kid) return <div className="screen"><p>Kid not found.</p></div>;

  const fmtWhen = (iso: string | null) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' });
  };

  if (loading || !view)
    return (
      <div className="screen">
        <div className="row"><button className="icon-btn" style={{ background: 'var(--track)', color: 'var(--ink)' }} onClick={() => nav('/kid')}><Icon.Back /></button><h1 style={{ fontSize: 24 }}>My stats</h1></div>
        <div className="skel" style={{ height: 130 }} /><div className="skel" style={{ height: 180 }} /><div className="skel" style={{ height: 110 }} />
      </div>
    );

  const nextLocked = view.badges.find((b) => !b.unlocked);

  return (
    <div className="screen">
      <div className="row"><button className="icon-btn" style={{ background: 'var(--track)', color: 'var(--ink)' }} onClick={() => nav('/kid')}><Icon.Back /></button><h1 style={{ fontSize: 24 }}>My stats</h1></div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
        <div className="row">
          <span className="pulse" style={{ fontSize: 30 }}>🔥</span>
          <div className="spacer">
            <div style={{ fontWeight: 800, fontSize: 19 }}>{kid.streakDays}-day streak</div>
            <div className="kid-sub">Best ever: {view.best} days</div>
          </div>
        </div>
        <div className="day-strip">
          {view.strip.map((d, n) => <i key={n} className={`${d.done ? 'done' : ''} ${d.today ? 'today' : ''}`} />)}
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div className="row row--between">
          <div className="section-label" style={{ margin: 0 }}>Points</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24 }}>⭐ {kid.points}</div>
        </div>
        <div style={{ marginTop: 6 }}>
          {view.ledger.length === 0 && <p className="quiet" style={{ margin: '8px 0 0' }}>Finish side quests to earn points, then spend them in the rewards shop.</p>}
          {view.ledger.map((e, n) => (
            <div key={n} className="ledger-row">
              <div className="spacer">
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{e.title}</div>
                <div className="kid-sub">{fmtWhen(e.when)} · {e.sub}</div>
              </div>
              <span className="ledger-amt" style={{ color: e.amt > 0 ? 'var(--ok-text)' : 'var(--danger)' }}>{e.amt > 0 ? `+${e.amt}` : `−${-e.amt}`}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="section-label">Badges</div>
      <div className="row" style={{ alignItems: 'stretch' }}>
        {view.badges.map((b) => (
          <div key={b.title} className="card" style={{ flex: 1, textAlign: 'center', padding: '14px 8px', opacity: b.unlocked ? 1 : .4 }}>
            <div style={{ fontSize: 30 }}>{b.emoji}</div>
            <div style={{ fontWeight: 800, fontSize: 13.5, marginTop: 4 }}>{b.title}</div>
            <div className="kid-sub" style={{ fontSize: 11.5 }}>{b.sub}</div>
          </div>
        ))}
      </div>
      {nextLocked && <p className="hint">To unlock {nextLocked.title}: {nextLocked.hint}.</p>}
    </div>
  );
}
