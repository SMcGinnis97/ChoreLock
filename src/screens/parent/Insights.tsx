import { useMemo, useState } from 'react';
import { useStore } from '../../lib/store';
import { Avatar } from '../../components/ui';
import { useHistory, isoDaysAgo, type History } from '../../lib/history';

/** 84px completion ring, stroke 9, draws in on mount. */
function BigRing({ pct }: { pct: number }) {
  const r = 37.5, c = 2 * Math.PI * r;
  return (
    <svg width="84" height="84" viewBox="0 0 84 84">
      <circle cx="42" cy="42" r={r} stroke="var(--track)" strokeWidth="9" fill="none" />
      <circle cx="42" cy="42" r={r} stroke="var(--accent)" strokeWidth="9" fill="none" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform="rotate(-90 42 42)"
        style={{ transition: 'stroke-dashoffset 1s ease-out' }}>
        <animate attributeName="stroke-dashoffset" from={c} to={c * (1 - pct)} dur="1s" fill="freeze" calcMode="spline" keySplines="0 0 .2 1" />
      </circle>
      <text x="42" y="49" textAnchor="middle" fontSize="19" fontWeight="800" fill="var(--ink)" fontFamily="var(--font-body)">{Math.round(pct * 100)}%</text>
    </svg>
  );
}

const HOUR_LABELS = ['6 AM', 'noon', '6 PM', 'midnight'];
const fmtHour = (h: number) => (h === 0 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`);

function stats(h: History, days: number) {
  const since = isoDaysAgo(days - 1);
  const inPeriod = h.instances.filter((i) => i.date >= since);
  const total = inPeriod.length;
  const approved = inPeriod.filter((i) => i.status === 'approved').length;
  const sentBack = inPeriod.reduce((n, i) => n + (i.attempt - 1) + (i.status === 'rejected' ? 1 : 0), 0);
  const latencies = inPeriod
    .filter((i) => i.status === 'approved' && i.submittedAt && i.reviewedAt)
    .map((i) => (new Date(i.reviewedAt!).getTime() - new Date(i.submittedAt!).getTime()) / 60000)
    .filter((m) => m >= 0 && m < 24 * 60);
  const avgReview = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
  const hourBuckets = Array.from({ length: 12 }, () => 0);
  inPeriod.forEach((i) => { if (i.submittedAt) hourBuckets[Math.floor(new Date(i.submittedAt).getHours() / 2)]++; });
  const quests = h.quests.filter((q) => q.status === 'approved' && q.reviewedAt && q.reviewedAt.slice(0, 10) >= since);
  return { total, approved, sentBack, avgReview, hourBuckets, quests };
}

export default function Insights() {
  const s = useStore();
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const days = period === 'week' ? 7 : 30;
  // Fetch twice the window so the delta vs the previous period is real.
  const { data, loading } = useHistory(days * 2, s.kids);

  const view = useMemo(() => {
    if (!data) return null;
    const cur = stats(data, days);
    const prevSince = isoDaysAgo(days * 2 - 1), curSince = isoDaysAgo(days - 1);
    const prevInst = data.instances.filter((i) => i.date >= prevSince && i.date < curSince);
    const prevPct = prevInst.length ? prevInst.filter((i) => i.status === 'approved').length / prevInst.length : null;
    const curPct = cur.total ? cur.approved / cur.total : 0;
    const delta = prevPct === null ? null : Math.round((curPct - prevPct) * 100);
    const peakIdx = cur.hourBuckets.indexOf(Math.max(...cur.hourBuckets));
    const maxBucket = Math.max(1, ...cur.hourBuckets);
    // Per kid: day-by-day completion for the current period.
    const perKid = s.kids.map((k) => {
      const daysArr = Array.from({ length: days }, (_, n) => {
        const date = isoDaysAgo(days - 1 - n);
        const day = data.instances.filter((i) => i.kidId === k.id && i.date === date && i.required);
        if (!day.length) return null; // no chores that day
        const done = day.filter((i) => i.status === 'approved').length;
        return done === day.length ? 'full' : done > 0 ? 'part' : 'none';
      });
      const mine = data.instances.filter((i) => i.kidId === k.id && i.date >= curSince);
      const pct = mine.length ? Math.round((mine.filter((i) => i.status === 'approved').length / mine.length) * 100) : null;
      return { kid: k, daysArr, pct };
    });
    return { cur, curPct, delta, peakIdx, maxBucket, perKid };
  }, [data, days, s.kids]);

  if (loading || !view)
    return (
      <div className="screen">
        <h1>Insights</h1>
        <div className="skel" style={{ height: 120 }} /><div className="skel" style={{ height: 160 }} /><div className="skel" style={{ height: 80 }} />
      </div>
    );

  const { cur, curPct, delta, peakIdx, maxBucket, perKid } = view;
  const questPts = cur.quests.reduce((n, q) => n + q.points, 0);

  return (
    <div className="screen">
      <div className="row row--between"><h1>Insights</h1></div>
      <div className="seg">
        <button className={period === 'week' ? 'active' : ''} onClick={() => setPeriod('week')}>This week</button>
        <button className={period === 'month' ? 'active' : ''} onClick={() => setPeriod('month')}>This month</button>
      </div>

      {(() => {
        // Co-parent visibility: today's reviews and grants, attributed by parent.
        const pname = (uid?: string) => {
          const p = s.parents.find((x) => x.userId === uid);
          return p ? (p.isMe ? 'You' : (p.name ?? p.email ?? 'A parent')) : 'A parent';
        };
        const kname = (kidId: string) => s.kids.find((k) => k.id === kidId)?.name ?? '?';
        const events = [
          ...s.instances.filter((i) => i.reviewedBy && i.reviewedAt && (i.status === 'approved' || i.status === 'rejected')).map((i) => ({
            at: i.reviewedAt!,
            text: `${pname(i.reviewedBy)} ${i.status === 'approved' ? 'approved' : 'sent back'} ${kname(i.kidId)}’s ${s.chores.find((c) => c.id === i.choreId)?.name ?? 'chore'}`,
            detail: i.status === 'rejected' && i.rejectionReason ? `“${i.rejectionReason}”` : undefined,
            emoji: i.status === 'approved' ? '✅' : '↩️',
          })),
          ...s.quests.filter((q) => q.reviewedBy && q.reviewedAt && (q.status === 'approved' || q.status === 'rejected')).map((q) => ({
            at: q.reviewedAt!,
            text: `${pname(q.reviewedBy)} ${q.status === 'approved' ? 'approved' : 'sent back'} the quest “${q.title}”${q.kidId ? ` (${kname(q.kidId)})` : ''}`,
            detail: q.status === 'rejected' && q.rejectionReason ? `“${q.rejectionReason}”` : undefined,
            emoji: q.status === 'approved' ? '⭐' : '↩️',
          })),
          ...s.rewardClaims.filter((c) => c.resolvedBy && c.resolvedAt && c.status !== 'requested').map((c) => ({
            at: c.resolvedAt!,
            text: `${pname(c.resolvedBy)} ${c.status === 'granted' ? 'granted' : 'denied'} ${kname(c.kidId)}’s reward: ${s.rewards.find((r) => r.id === c.rewardId)?.title ?? '?'}`,
            detail: undefined as string | undefined,
            emoji: c.status === 'granted' ? '🎁' : '🚫',
          })),
        ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
        if (!events.length) return null;
        return (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="section-label" style={{ margin: 0 }}>Parent activity today</div>
            {events.map((e, n) => (
              <div key={n} className="row" style={{ alignItems: 'baseline', gap: 8 }}>
                <span aria-hidden>{e.emoji}</span>
                <div className="spacer">
                  <span style={{ fontWeight: 700 }}>{e.text}</span>
                  {e.detail && <span className="kid-sub"> · {e.detail}</span>}
                </div>
                <span className="kid-sub" style={{ whiteSpace: 'nowrap' }}>{new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
              </div>
            ))}
          </div>
        );
      })()}

      <div className="card row" style={{ padding: 16, gap: 16 }}>
        <BigRing pct={curPct} />
        <div className="spacer">
          <div style={{ fontWeight: 800, fontSize: 17 }}>Family completion</div>
          <div className="kid-sub">{cur.approved} of {cur.total} chores approved</div>
          {delta !== null && (
            <span className="chip" style={{ marginTop: 6, background: delta >= 0 ? 'var(--ok-tint)' : 'var(--warn-tint)', color: delta >= 0 ? 'var(--ok-text)' : 'var(--warn-text)' }}>
              {delta >= 0 ? '▲' : '▼'} {delta >= 0 ? '+' : ''}{delta}% vs last {period}
            </span>
          )}
        </div>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="section-label" style={{ margin: 0 }}>By kid</div>
        {perKid.map(({ kid, daysArr, pct }) => (
          <div key={kid.id} className="row">
            <Avatar kid={kid} />
            <div style={{ fontWeight: 800, width: 76 }}>{kid.name}</div>
            <div className="day-bars spacer" style={{ overflow: 'hidden' }}>
              {daysArr.map((d, n) => (
                <i key={n} className={d === 'part' ? 'part' : ''} style={{ width: period === 'week' ? 14 : 5, height: d === 'full' ? 18 : d === 'part' ? 11 : 3, opacity: d === null ? .25 : 1, animationDelay: `${Math.min(n * 0.05, 0.36)}s` }} />
              ))}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 800 }}>{pct === null ? '—' : `${pct}%`}</div>
              <div className="kid-sub">🔥 {kid.streakDays}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="kpi-row">
        <div className="card kpi"><div className="num">{cur.approved + cur.sentBack ? Math.round((cur.approved / (cur.approved + cur.sentBack)) * 100) : 100}%</div><div className="lab">approval rate</div></div>
        <div className="card kpi"><div className="num">{cur.avgReview === null ? '—' : `${cur.avgReview} min`}</div><div className="lab">avg review</div></div>
        <div className="card kpi"><div className="num">{cur.sentBack}</div><div className="lab">sent back</div></div>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="section-label" style={{ margin: 0 }}>Busiest chore times</div>
        <div className="heat-strip">
          {cur.hourBuckets.map((n, i) => <i key={i} style={{ opacity: 0.12 + 0.88 * (n / maxBucket) }} />)}
        </div>
        <div className="row row--between" style={{ padding: '0 2px' }}>
          {HOUR_LABELS.map((l) => <span key={l} className="kid-sub" style={{ fontSize: 11 }}>{l}</span>)}
        </div>
        {cur.hourBuckets[peakIdx] > 0 && <p className="quiet" style={{ margin: 0 }}>Peak: {fmtHour(peakIdx * 2)}–{fmtHour(peakIdx * 2 + 2)}{peakIdx === 8 ? ', right after school' : ''}</p>}
      </div>

      <div className="card row">
        <span className="chore-emoji">⭐</span>
        <div className="spacer">
          <div style={{ fontWeight: 800 }}>Side quests this {period}</div>
          <div className="kid-sub">{cur.quests.length} approved · ⭐ {questPts} points awarded</div>
        </div>
      </div>
    </div>
  );
}
