/**
 * Historical chore/quest/reward data for the Insights and My Stats screens.
 * Live mode reads Supabase directly (RLS-scoped); mock mode synthesizes a
 * deterministic demo history from the mock kids so the screens always render.
 */
import { useEffect, useMemo, useState } from 'react';
import { hasBackend, supabase } from './supabase';
import type { Kid } from './types';

export interface HistInstance {
  kidId: string;
  choreId: string;
  date: string; // YYYY-MM-DD
  status: 'todo' | 'submitted' | 'approved' | 'rejected';
  attempt: number;
  submittedAt: string | null; // ISO
  reviewedAt: string | null; // ISO
  required: boolean;
}

export interface HistQuest { kidId: string | null; title: string; points: number; status: string; reviewedAt: string | null }
export interface HistClaim { kidId: string; title: string; points: number; status: string; resolvedAt: string | null }

export interface History {
  instances: HistInstance[];
  quests: HistQuest[];
  claims: HistClaim[];
}

export const isoDaysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Deterministic demo history: each kid completes most days, misses a few. */
function synth(kids: Kid[], days: number): History {
  const instances: HistInstance[] = [];
  const quests: HistQuest[] = [];
  kids.forEach((k, ki) => {
    for (let d = 0; d < days; d++) {
      const date = isoDaysAgo(d);
      const perDay = 2 + ((ki + d) % 2);
      for (let c = 0; c < perDay; c++) {
        const seed = (ki * 31 + d * 7 + c * 13) % 20;
        const miss = seed === 3; // ~5% missed entirely
        const reject = seed === 7; // one redo
        const hour = 15 + ((seed + c) % 5); // after school
        const sub = `${date}T${String(hour).padStart(2, '0')}:${String((seed * 3) % 60).padStart(2, '0')}:00`;
        const rev = `${date}T${String(hour).padStart(2, '0')}:${String(((seed * 3) % 60) + Math.min(59 - ((seed * 3) % 60), 12)).padStart(2, '0')}:00`;
        instances.push({
          kidId: k.id, choreId: `c${c}`, date,
          status: miss ? 'todo' : 'approved',
          attempt: reject ? 2 : 1,
          submittedAt: miss ? null : sub, reviewedAt: miss ? null : rev,
          required: c < 2,
        });
      }
    }
    quests.push({ kidId: k.id, title: 'Pull weeds by the mailbox', points: 15, status: 'approved', reviewedAt: isoDaysAgo(2) + 'T17:00:00' });
  });
  const claims: HistClaim[] = kids[0] ? [{ kidId: kids[0].id, title: 'Ice cream run', points: 30, status: 'granted', resolvedAt: isoDaysAgo(4) + 'T18:00:00' }] : [];
  return { instances, quests, claims };
}

/**
 * Fetch `days` of history (for the kids passed in — parent gets the family, kid gets self).
 * Returns null while loading in live mode.
 */
export function useHistory(days: number, kids: Kid[]): { data: History | null; loading: boolean } {
  const [live, setLive] = useState<History | null>(null);
  const [loading, setLoading] = useState(hasBackend);
  const kidsKey = kids.map((k) => k.id).join(',');

  useEffect(() => {
    if (!hasBackend || !kidsKey) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const sb = supabase!;
      const since = isoDaysAgo(days - 1);
      const [inst, ch, qs, rc, rw] = await Promise.all([
        sb.from('chore_instances').select('kid_id,chore_id,date,status,attempt,submitted_at,reviewed_at').gte('date', since).in('kid_id', kidsKey.split(',')),
        sb.from('chores').select('id,required'),
        sb.from('side_quests').select('kid_id,title,points,status,reviewed_at'),
        sb.from('reward_claims').select('kid_id,status,resolved_at,reward_id'),
        sb.from('rewards').select('id,title,points'),
      ]);
      if (cancelled) return;
      const req = new Map((ch.data ?? []).map((c) => [c.id, !!c.required]));
      const rewardMap = new Map((rw.data ?? []).map((r) => [r.id, r]));
      setLive({
        instances: (inst.data ?? []).map((i) => ({
          kidId: i.kid_id, choreId: i.chore_id, date: i.date, status: i.status, attempt: i.attempt,
          submittedAt: i.submitted_at, reviewedAt: i.reviewed_at, required: req.get(i.chore_id) ?? true,
        })),
        quests: (qs.data ?? []).map((q) => ({ kidId: q.kid_id, title: q.title, points: q.points, status: q.status, reviewedAt: q.reviewed_at })),
        claims: (rc.data ?? []).map((c) => ({ kidId: c.kid_id, title: rewardMap.get(c.reward_id)?.title ?? 'Reward', points: rewardMap.get(c.reward_id)?.points ?? 0, status: c.status, resolvedAt: c.resolved_at })),
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [days, kidsKey]);

  const demo = useMemo(() => (hasBackend ? null : synth(kids, days)), [kidsKey, days]); // eslint-disable-line react-hooks/exhaustive-deps
  return hasBackend ? { data: live, loading } : { data: demo, loading: false };
}
