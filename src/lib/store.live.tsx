/**
 * Supabase-backed store. Same `Store` interface as the mock so screens don't change.
 *
 * Parent: email/password session -> parents row -> family.
 * Kid:    anonymous session -> kid_users row (via join_as_kid RPC) -> one kid.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { bedtimeNow, blocksNow, buildShieldContent, criticalLocked, fmtClock, hasPass, isGrounded, Ctx, type CriticalDraft, type QuestDraft, type Role, type Store } from './store';
import type { Chore, ChoreGroup, ChoreInstance, CriticalInstance, CriticalTask, Device, FamilyParent, Kid, ListItem, LockState, MoneyEntry, NightEvent, ProofMedia, Reward, RewardClaim, Settings, SideQuest, Summon, UnlockRequest } from './types';
import { applyLockState, RESET_SHIELD, type BedtimeSlot } from '../native/screenTime';
import { Capacitor } from '@capacitor/core';
import { installId, setupPush } from '../native/push';
import ScreenTime from '../native/screenTime';

const sb = () => supabase!;
const fmtTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : undefined);
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/**
 * Runs `cb` whenever the app comes back to the foreground. WKWebView does not
 * reliably fire `visibilitychange` when Capacitor resumes from the app switcher
 * (observed: after the midnight reset the kid app kept yesterday's chore list
 * until force-quit), so we listen to every signal we can get: visibilitychange,
 * window focus, pageshow, and the `chorekeyResume` event MyViewController posts
 * from UIApplication.didBecomeActive. Debounced so the burst counts once.
 */
function onForeground(cb: () => void) {
  let last = 0;
  const fire = () => { const n = Date.now(); if (n - last < 800) return; last = n; cb(); };
  const onVis = () => { if (document.visibilityState === 'visible') fire(); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('focus', fire);
  window.addEventListener('pageshow', fire);
  window.addEventListener('chorekeyResume', fire);
  return () => {
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('focus', fire);
    window.removeEventListener('pageshow', fire);
    window.removeEventListener('chorekeyResume', fire);
  };
}
const isVideoPath = (p?: string | null) => !!p && (p.endsWith('.mp4') || p.endsWith('.webm'));
const signed = async (path?: string | null) => {
  if (!path) return undefined;
  const { data } = await sb().storage.from('proofs').createSignedUrl(path, 3600);
  return data?.signedUrl;
};

export interface Identity { session: Session | null; role: Role | null; familyId: string | null; kidId: string | null; ready: boolean }

export function useIdentity(): Identity & { refresh: () => Promise<void> } {
  const [id, setId] = useState<Identity>({ session: null, role: null, familyId: null, kidId: null, ready: false });
  const resolve = useCallback(async (session: Session | null) => {
    if (!session) return setId({ session: null, role: null, familyId: null, kidId: null, ready: true });
    const [{ data: p }, { data: k }] = await Promise.all([
      sb().from('parents').select('family_id').eq('user_id', session.user.id).maybeSingle(),
      sb().from('kid_users').select('kid_id').eq('user_id', session.user.id).maybeSingle(),
    ]);
    setId({ session, role: p ? 'parent' : k ? 'kid' : null, familyId: p?.family_id ?? null, kidId: k?.kid_id ?? null, ready: true });
  }, []);
  useEffect(() => {
    sb().auth.getSession().then(({ data }) => resolve(data.session));
    const { data: sub } = sb().auth.onAuthStateChange((_e, s) => { void resolve(s); });
    return () => sub.subscription.unsubscribe();
  }, [resolve]);
  return { ...id, refresh: async () => resolve((await sb().auth.getSession()).data.session) };
}

export function LiveStoreProvider({ identity, children }: { identity: Identity; children: ReactNode }) {
  const role = identity.role ?? 'kid';
  const [kids, setKids] = useState<Kid[]>([]);
  const [chores, setChores] = useState<Chore[]>([]);
  const [groups, setGroups] = useState<ChoreGroup[]>([]);
  const [instances, setInstances] = useState<ChoreInstance[]>([]);
  const [quests, setQuests] = useState<SideQuest[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [parents, setParents] = useState<FamilyParent[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [rewardClaims, setRewardClaims] = useState<RewardClaim[]>([]);
  const [settings, setSettings] = useState<Settings>({ resetTime: '00:00', autoApprove: false, routerStatus: 'none' });
  const [summons, setSummons] = useState<Summon[]>([]);
  const [criticalTasks, setCriticalTasks] = useState<CriticalTask[]>([]);
  const [criticalInstances, setCriticalInstances] = useState<CriticalInstance[]>([]);
  const [unlockRequests, setUnlockRequests] = useState<UnlockRequest[]>([]);
  const [listItems, setListItems] = useState<ListItem[]>([]);
  const [moneyLedger, setMoneyLedger] = useState<MoneyEntry[]>([]);
  const [nightEvents, setNightEvents] = useState<NightEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentKidId, setCurrentKidId] = useState(identity.kidId ?? '');
  const [tick, setTick] = useState(0); // minute pulse so due-time lock flips re-evaluate while open
  const lastApplied = useRef<string | null>(null); // JSON of [lockState, shieldContent]
  const loadedDate = useRef(localDate()); // device-local date of the last load — a rollover forces a reload
  const [rtEpoch, setRtEpoch] = useState(0); // bump to tear down + resubscribe the realtime channel

  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);

  const load = useCallback(async () => {
    try {
      setError(null);
      loadedDate.current = localDate();
      const kidIds = role === 'kid' ? [identity.kidId!] : null;
      // Ensure today's instances exist (idempotent) before reading.
      const { data: kidRows, error: ke } = kidIds
        ? await sb().from('kids').select('*').in('id', kidIds)
        : await sb().from('kids').select('*').eq('family_id', identity.familyId!).order('created_at');
      if (ke) throw ke;
      await Promise.all((kidRows ?? []).map((k) => sb().rpc('ensure_today', { p_kid: k.id })));

      const [fam, invite, pars, rw, rc, ch, asg, grp, gk, inst, qs, dev, pts, streaks, smn, ctk, cin, ur, li, ml, ne] = await Promise.all([
        sb().from('families').select('*').single(),
        role === 'parent' ? sb().from('parent_invites').select('code').maybeSingle() : Promise.resolve({ data: null }),
        role === 'parent' ? sb().from('family_parents').select('*') : Promise.resolve({ data: [] }),
        sb().from('rewards').select('*').eq('archived', false).order('points'),
        sb().from('reward_claims').select('*').order('requested_at', { ascending: false }),
        sb().from('chores').select('*').eq('archived', false),
        sb().from('chore_assignments').select('*'),
        sb().from('chore_groups').select('*').order('created_at'),
        sb().from('chore_group_kids').select('*').order('position'),
        sb().from('chore_instances').select('*').in('kid_id', (kidRows ?? []).map((k) => k.id)),
        sb().from('side_quests').select('*').order('created_at', { ascending: false }),
        sb().from('devices').select('*'),
        sb().from('kid_points').select('*'),
        Promise.all((kidRows ?? []).map((k) => sb().rpc('kid_streak', { p_kid: k.id }).then((r) => [k.id, r.data ?? 0] as const))),
        sb().from('summons').select('*').gte('created_at', new Date(Date.now() - 30 * 60_000).toISOString()).order('created_at', { ascending: false }),
        sb().from('critical_tasks').select('*').order('first_fire'),
        sb().from('critical_instances').select('*').or(`status.in.(open,scheduled),created_at.gte.${new Date(Date.now() - 24 * 3600_000).toISOString()}`).order('created_at', { ascending: false }),
        sb().from('unlock_requests').select('*').gte('created_at', new Date(Date.now() - 24 * 3600_000).toISOString()).order('created_at', { ascending: false }),
        sb().from('list_items').select('*').or(`done_at.is.null,done_at.gte.${new Date(Date.now() - 24 * 3600_000).toISOString()}`).order('created_at', { ascending: false }),
        sb().from('money_ledger').select('*').order('created_at', { ascending: false }),
        sb().from('night_events').select('*').gte('at', new Date(Date.now() - 7 * 24 * 3600_000).toISOString()).order('at', { ascending: false }),
      ]);
      const streakMap = Object.fromEntries(streaks);
      const pointsMap = Object.fromEntries((pts.data ?? []).map((p) => [p.kid_id, p.points]));
      // Only today's instances (family-local date comes back from ensure_today, but filter by max date).
      const todayStr = (inst.data ?? []).reduce((m, i) => (i.date > m ? i.date : m), '');
      const todays = (inst.data ?? []).filter((i) => i.date === todayStr);

      setSettings({
        resetTime: fam.data?.reset_time?.slice(0, 5) ?? '00:00', autoApprove: fam.data?.auto_approve ?? false,
        routerStatus: 'none', parentCode: invite.data?.code ?? undefined,
        streakRewardDays: fam.data?.streak_reward_days ?? undefined, streakRewardCents: fam.data?.streak_reward_cents ?? undefined,
        nightStart: fam.data?.night_start ? fam.data.night_start.slice(0, 5) : undefined,
        nightEnd: fam.data?.night_end ? fam.data.night_end.slice(0, 5) : undefined,
        nightThresholdMin: fam.data?.night_threshold_min ?? 15,
      });
      setChores(await Promise.all((ch.data ?? []).map(async (c) => ({
        id: c.id, name: c.name, emoji: c.emoji, instruction: c.instruction ?? undefined, recurrence: c.recurrence,
        days: c.days ?? [], rotation: c.rotation ?? 'none', dueTime: c.due_time ? c.due_time.slice(0, 5) : undefined,
        overdue: c.overdue ?? 'block', required: c.required, photoProof: c.photo_proof, proofType: c.proof_type ?? 'photo',
        groupId: c.group_id ?? undefined, refPaths: (c.ref_paths as string[] | null) ?? undefined,
        refUrls: c.ref_paths ? (await Promise.all((c.ref_paths as string[]).map(signed))).filter((u): u is string => !!u) : undefined,
        kidIds: (asg.data ?? []).filter((a) => a.chore_id === c.id).map((a) => a.kid_id),
      } as Chore))));
      setGroups((grp.data ?? []).map((g) => ({
        id: g.id, name: g.name, emoji: g.emoji ?? '📋', rotationIndex: g.rotation_index ?? 0,
        kidIds: (gk.data ?? []).filter((x) => x.group_id === g.id).map((x) => x.kid_id),
      })));
      setKids((kidRows ?? []).map((k) => ({ id: k.id, name: k.name, age: k.age ?? 0, avatarColor: k.avatar_color, lockState: 'unknown', streakDays: streakMap[k.id] ?? 0, points: pointsMap[k.id] ?? 0, override: k.override_date === todayStr ? k.override : null, absentUntil: k.absent_until && k.absent_until >= todayStr ? k.absent_until : undefined, groundedUntil: k.grounded_until ?? undefined, groundedReason: k.grounded_reason ?? undefined, unlockUntil: k.unlock_until ?? undefined, bedStart: k.bed_start ? k.bed_start.slice(0, 5) : undefined, bedEnd: k.bed_end ? k.bed_end.slice(0, 5) : undefined, bedStartWeekend: k.bed_start_weekend ? k.bed_start_weekend.slice(0, 5) : undefined, bedEndWeekend: k.bed_end_weekend ? k.bed_end_weekend.slice(0, 5) : undefined, bedOffDate: k.bed_off_date ?? undefined, joinCode: k.join_code ?? undefined })));
      setInstances(await Promise.all(todays.map(async (i) => {
        const paths: string[] = (i.photo_paths as string[] | null) ?? (i.photo_path ? [i.photo_path] : []);
        const photoUrls = (await Promise.all(paths.map(signed))).filter((u): u is string => !!u);
        return {
          id: i.id, choreId: i.chore_id, kidId: i.kid_id, date: i.date, status: i.status, attempt: i.attempt,
          photoUrl: photoUrls[0], photoUrls, videoUrl: await signed(i.video_path),
          rolled: i.rolled ?? false, streakExempt: i.streak_exempt ?? false, dueOverride: i.due_override ? i.due_override.slice(0, 5) : undefined,
          note: i.note ?? undefined, submittedAt: fmtTime(i.submitted_at), rejectionReason: i.rejection_reason ?? undefined,
          reviewedBy: i.reviewed_by ?? undefined, reviewedAt: i.reviewed_at ?? undefined,
        } as ChoreInstance;
      })));
      setRewards((rw.data ?? []).map((r) => ({ id: r.id, title: r.title, emoji: r.emoji, points: r.points })));
      setRewardClaims((rc.data ?? []).map((c) => ({ id: c.id, rewardId: c.reward_id, kidId: c.kid_id, status: c.status, resolvedBy: c.resolved_by ?? undefined, resolvedAt: c.resolved_at ?? undefined })));
      setQuests(await Promise.all((qs.data ?? []).map(async (q) => ({
        id: q.id, title: q.title, note: q.note ?? undefined, points: q.points, cents: q.cents ?? undefined, kidId: q.kid_id,
        claimedAt: q.claimed_at ?? undefined,
        status: q.status, promptUrls: (await Promise.all(((q.prompt_paths ?? []) as string[]).map(signed))).filter((u): u is string => !!u),
        proofUrl: await signed(q.proof_path), proofIsVideo: isVideoPath(q.proof_path),
        proofNote: q.proof_note ?? undefined, rejectionReason: q.rejection_reason ?? undefined, submittedAt: fmtTime(q.submitted_at),
        reviewedBy: q.reviewed_by ?? undefined, reviewedAt: q.reviewed_at ?? undefined,
      }))));
      setDevices((dev.data ?? []).map((d) => ({ id: d.id, kidId: d.kid_id, name: d.name, platform: d.platform, identifier: d.identifier, lastSeen: d.last_seen ?? undefined, blocked: false, override: d.override ?? null, scheduleStart: d.schedule_start ? d.schedule_start.slice(0, 5) : undefined, scheduleEnd: d.schedule_end ? d.schedule_end.slice(0, 5) : undefined })));
      setParents((pars.data ?? []).map((p: { user_id: string; display_name: string | null; email: string | null }) => ({ userId: p.user_id, name: p.display_name ?? undefined, email: p.email ?? undefined, isMe: p.user_id === identity.session?.user.id })));
      setSummons((smn.data ?? []).map((x) => ({
        id: x.id, kidId: x.kid_id, location: x.location, note: x.note ?? undefined, meeting: x.meeting,
        createdAt: x.created_at, expiresAt: x.expires_at, acknowledgedAt: x.acknowledged_at ?? undefined, canceledAt: x.canceled_at ?? undefined,
      })));
      setCriticalTasks((ctk.data ?? []).map((t) => ({
        id: t.id, kidId: t.kid_id, title: t.title, emoji: t.emoji, note: t.note ?? undefined,
        firstFire: t.first_fire.slice(0, 5), repeatMinutes: t.repeat_minutes ?? undefined,
        windowEnd: t.window_end ? t.window_end.slice(0, 5) : undefined,
        lockAfterMin: t.lock_after_min, broadcastAfterMin: t.broadcast_after_min, lockAllAfterMin: t.lock_all_after_min,
        followupTitle: t.followup_title ?? undefined, followupDelayMin: t.followup_delay_min,
        active: t.active, nextFireAt: t.next_fire_at ?? undefined,
      })));
      setCriticalInstances((cin.data ?? []).map((x) => ({
        id: x.id, taskId: x.task_id, kidId: x.kid_id, kind: x.kind, title: x.title, dueAt: x.due_at,
        status: x.status, level: x.level, doneAt: x.done_at ?? undefined, doneBy: x.done_by ?? undefined,
      })));
      setUnlockRequests((ur.data ?? []).map((r) => ({
        id: r.id, kidId: r.kid_id, kind: r.kind, status: r.status,
        createdAt: r.created_at, resolvedAt: r.resolved_at ?? undefined,
      })));
      setListItems((li.data ?? []).map((x) => ({
        id: x.id, text: x.text, addedByKid: x.added_by_kid ?? undefined,
        doneAt: x.done_at ?? undefined, createdAt: x.created_at,
      })));
      setMoneyLedger((ml.data ?? []).map((m) => ({
        id: m.id, kidId: m.kid_id, cents: m.cents, kind: m.kind, note: m.note ?? undefined, createdAt: m.created_at,
      })));
      setNightEvents((ne.data ?? []).map((n) => ({ id: n.id, kidId: n.kid_id, kind: n.kind, at: n.at })));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [role, identity.kidId, identity.familyId]);

  useEffect(() => { void load(); }, [load]);

  // The day rolled over while the app sat open (iPad on the couch overnight):
  // yesterday's instances are dead, fetch today's. The minute tick drives this.
  useEffect(() => {
    if (!loading && loadedDate.current !== localDate()) void load();
  }, [tick, loading, load]);

  // Realtime: any change to instances/kids/quests in scope -> reload.
  useEffect(() => {
    const chan = sb().channel(`chorelock-${rtEpoch}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chore_instances' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kids' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'side_quests' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reward_claims' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'summons' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'critical_instances' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'critical_tasks' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'unlock_requests' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'list_items' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'money_ledger' }, () => void load())
      .subscribe();
    const off = onForeground(() => {
      void (async () => {
        // A long background suspends the socket and can outlive the access token:
        // refresh the session first so the reload isn't a 401, then reload, and
        // resubscribe if the channel never came back on its own.
        try { await sb().auth.getSession(); } catch { /* offline — load() reports it */ }
        await load();
        if (chan.state !== 'joined' && chan.state !== 'joining') setRtEpoch((n) => n + 1);
      })();
    });
    return () => { sb().removeChannel(chan); off(); };
  }, [load, rtEpoch]);

  // Register this install as a device for the kid, set up APNs, and hand the reset time to the
  // native DeviceActivity schedule so the shield re-engages locally even without network.
  useEffect(() => {
    if (role !== 'kid' || !identity.kidId || !Capacitor.isNativePlatform()) return;
    void (async () => {
      await sb().from('devices').upsert({ kid_id: identity.kidId, name: `${navigator.platform || 'iOS'} device`, platform: 'ios', identifier: `ios-${installId()}`, last_seen: new Date().toISOString() }, { onConflict: 'kid_id,identifier' });
      await setupPush(identity.kidId!, () => void load());
    })();
  }, [role, identity.kidId, load]);
  useEffect(() => {
    if (role !== 'kid' || !Capacitor.isNativePlatform() || loading) return;
    const [h, m] = settings.resetTime.split(':').map(Number);
    // Log failures — a silently-rejected registration here is exactly how the
    // 1-minute-window bug hid for weeks (DeviceActivity requires >= 15 min).
    void ScreenTime.scheduleDailyReset({ hour: h, minute: m }).catch((e) => console.warn('[ScreenTime] scheduleDailyReset failed', e));
  }, [role, loading, settings.resetTime]);

  // Shield-button taps ("Ask for 15 minutes" / "I'm doing it now") and night-watch
  // flags queue in the app group while the app is closed; forward them to Supabase
  // on launch and foreground.
  useEffect(() => {
    if (role !== 'kid' || !identity.kidId || !Capacitor.isNativePlatform()) return;
    const drain = async () => {
      try {
        const { requests } = await ScreenTime.drainShieldRequests();
        for (const r of requests) await sb().rpc('request_unlock', { p_kind: r.kind });
        const { events } = await ScreenTime.drainNightEvents();
        for (const e of events) await sb().rpc('record_night_event', { p_kind: e.kind, p_at: new Date(e.at * 1000).toISOString() });
        if (requests.length || events.length) void load();
      } catch { /* older native build without the methods */ }
    };
    void drain();
    return onForeground(() => void drain());
  }, [role, identity.kidId, load]);

  // Keep the night-watch schedules on the kid device in sync with family settings.
  useEffect(() => {
    if (role !== 'kid' || !Capacitor.isNativePlatform() || loading) return;
    const on = !!settings.nightStart && !!settings.nightEnd;
    const [sh, sm] = (settings.nightStart ?? '22:00').split(':').map(Number);
    const [eh, em] = (settings.nightEnd ?? '06:00').split(':').map(Number);
    void ScreenTime.configureNightWatch({
      enabled: on, startHour: sh, startMinute: sm, endHour: eh, endMinute: em,
      thresholdMinutes: settings.nightThresholdMin ?? 15,
    }).catch(() => {});
  }, [role, loading, settings.nightStart, settings.nightEnd, settings.nightThresholdMin]);

  const uploadProof = useCallback(async (path: string, media: ProofMedia) => {
    const { error: ue } = await sb().storage.from('proofs').upload(path, media.blob, { contentType: media.contentType, upsert: true });
    if (ue) throw ue;
    return path;
  }, []);

  const store = useMemo<Store>(() => {
    void tick; // due-time lock windows depend on wall-clock time
    const requiredProgress = (kidId: string) => {
      const req = instances.filter((i) => i.kidId === kidId && chores.find((c) => c.id === i.choreId)?.required);
      return { done: req.filter((i) => i.status === 'approved').length, total: req.length };
    };
    const kidLockState = (kidId: string, opts?: { ignoreBedtime?: boolean }): LockState => {
      if (error) return 'unknown';
      const kid = kids.find((k) => k.id === kidId);
      if (isGrounded(kid)) return 'locked';
      if (kid?.absentUntil) return 'unlocked';
      if (criticalLocked(criticalTasks, criticalInstances, kidId)) return 'locked';
      if (hasPass(kid)) return 'unlocked';
      if (!opts?.ignoreBedtime && bedtimeNow(kid).active) return 'locked';
      if (kid?.override === 'unlock') return 'unlocked';
      if (kid?.override === 'lock') return 'locked';
      return instances.some((i) => i.kidId === kidId && blocksNow(i, chores.find((c) => c.id === i.choreId))) ? 'locked' : 'unlocked';
    };
    const allClear = kids.length > 0 && kids.every((k) => kidLockState(k.id) === 'unlocked');
    const devicesWithState = devices.map((d) => ({ ...d, blocked: d.override === 'unlock' ? false : d.override === 'lock' ? true : d.kidId ? kidLockState(d.kidId) === 'locked' : !allClear }));

    return {
      role, setRole: () => {}, currentKidId, setCurrentKidId,
      kids, chores, groups, instances, quests, devices: devicesWithState, settings, parents, rewards, rewardClaims, summons, loading, error,
      criticalTasks, criticalInstances, unlockRequests, listItems, moneyLedger, nightEvents,
      kidLockState, requiredProgress,
      pendingCount: instances.filter((i) => i.status === 'submitted').length + quests.filter((q) => q.status === 'submitted').length + rewardClaims.filter((c) => c.status === 'requested').length,
      submit: async (id, proof, note) => {
        const inst = instances.find((i) => i.id === id)!;
        const kid = kids.find((k) => k.id === inst.kidId)!;
        const base = `${identity.familyId ?? 'f'}/${kid.id}/${inst.date}/${inst.choreId}-${inst.attempt}`;
        const photos = proof.photos.slice(0, 5);
        let photoPaths: string[] = [], videoPath: string | null = null;
        try {
          photoPaths = await Promise.all(photos.map((p, n) => uploadProof(n === 0 ? `${base}.${p.ext}` : `${base}-p${n}.${p.ext}`, p)));
          if (proof.video) videoPath = await uploadProof(`${base}-v.${proof.video.ext}`, proof.video);
        } catch (e) { setError((e as Error).message); return; }
        const urls = photos.map((p) => p.previewUrl);
        setInstances((cur) => cur.map((i) => (i.id === id ? { ...i, status: 'submitted', photoUrl: urls[0], photoUrls: urls, videoUrl: proof.video?.previewUrl, note } : i)));
        // Always 'submitted' — a server trigger auto-approves first attempts when the family setting is on.
        const { error: se } = await sb().from('chore_instances').update({ status: 'submitted', ...(photoPaths.length && { photo_path: photoPaths[0], photo_paths: photoPaths }), ...(videoPath && { video_path: videoPath }), note: note ?? null, submitted_at: new Date().toISOString() }).eq('id', id);
        if (se) { setError(`Submit didn’t save: ${se.message}`); await load(); }
      },
      approve: async (id) => {
        setInstances((cur) => cur.map((i) => (i.id === id ? { ...i, status: 'approved', rejectionReason: undefined } : i)));
        await sb().from('chore_instances').update({ status: 'approved', rejection_reason: null, reviewed_at: new Date().toISOString(), reviewed_by: identity.session?.user.id }).eq('id', id);
      },
      reject: async (id, reason, keepStreak) => {
        setInstances((cur) => cur.map((i) => (i.id === id ? { ...i, status: 'rejected', rejectionReason: reason, attempt: i.attempt + 1, streakExempt: !!keepStreak } : i)));
        const inst = instances.find((i) => i.id === id)!;
        await sb().from('chore_instances').update({ status: 'rejected', rejection_reason: reason, attempt: inst.attempt + 1, streak_exempt: !!keepStreak, reviewed_at: new Date().toISOString(), reviewed_by: identity.session?.user.id }).eq('id', id);
      },
      reopen: async (id) => {
        setInstances((cur) => cur.map((i) => (i.id === id ? { ...i, status: 'todo', rejectionReason: undefined } : i)));
        await sb().from('chore_instances').update({ status: 'todo', rejection_reason: null, reviewed_at: new Date().toISOString(), reviewed_by: identity.session?.user.id }).eq('id', id);
      },
      setDueOverride: async (id, time) => {
        setInstances((cur) => cur.map((i) => (i.id === id ? { ...i, dueOverride: time ?? undefined } : i)));
        const { error: e } = await sb().from('chore_instances').update({ due_override: time }).eq('id', id);
        if (e) { setError(`Due time didn’t save: ${e.message}`); await load(); }
      },
      deferInstance: async (id) => {
        setInstances((cur) => cur.map((i) => (i.id === id ? { ...i, rolled: true } : i)));
        const { error: e } = await sb().rpc('defer_instance', { p_instance: id });
        if (e) { setError(`Couldn’t move it: ${e.message}`); }
        await load();
      },
      completeQuest: async (id, kidId) => {
        const q = quests.find((x) => x.id === id);
        const owner = q?.kidId ?? kidId ?? null;
        if (!owner) return;
        setQuests((cur) => cur.map((x) => (x.id === id ? { ...x, kidId: owner, status: 'approved', rejectionReason: undefined } : x)));
        const { error: e } = await sb().from('side_quests').update({ kid_id: owner, status: 'approved', rejection_reason: null, reviewed_at: new Date().toISOString(), reviewed_by: identity.session?.user.id }).eq('id', id);
        if (e) { setError(`Quest didn’t save: ${e.message}`); }
        await load();
      },
      override: async (kidId, mode) => {
        setKids((cur) => cur.map((k) => (k.id === kidId ? { ...k, override: mode } : k)));
        const { error: e } = await sb().rpc('set_override', { p_kid: kidId, mode });
        if (e) { setError(`Override didn’t save: ${e.message}`); await load(); }
      },
      setAbsent: async (kidId, until) => {
        setKids((cur) => cur.map((k) => (k.id === kidId ? { ...k, absentUntil: until ?? undefined } : k)));
        const { error: e } = await sb().from('kids').update({ absent_until: until }).eq('id', kidId);
        if (e) { setError(`Away didn’t save: ${e.message}`); await load(); }
      },
      callKids: async (kidIds, location, note, meeting) => {
        await sb().rpc('call_kids', { p_kids: kidIds, p_location: location, p_note: note ?? null, p_meeting: !!meeting });
        await load();
      },
      ackSummon: async (id) => {
        setSummons((cur) => cur.map((x) => (x.id === id ? { ...x, acknowledgedAt: new Date().toISOString() } : x)));
        await sb().rpc('ack_summon', { p_id: id });
      },
      cancelSummon: async (id) => {
        setSummons((cur) => cur.map((x) => (x.id === id ? { ...x, canceledAt: new Date().toISOString() } : x)));
        await sb().from('summons').update({ canceled_at: new Date().toISOString() }).eq('id', id);
      },
      saveCriticalTask: async (t: CriticalDraft) => {
        const { error: e } = await sb().rpc('save_critical_task', {
          p_id: t.id ?? null, p_kid: t.kidId, p_title: t.title, p_emoji: t.emoji, p_note: t.note ?? null,
          p_first_fire: t.firstFire, p_repeat_minutes: t.repeatMinutes ?? null, p_window_end: t.windowEnd ?? null,
          p_lock_after: t.lockAfterMin, p_broadcast_after: t.broadcastAfterMin, p_lock_all_after: t.lockAllAfterMin,
          p_followup_title: t.followupTitle ?? null, p_followup_delay: t.followupDelayMin, p_active: t.active,
        });
        if (e) { setError(e.message); return; }
        await load();
      },
      deleteCriticalTask: async (id) => {
        setCriticalTasks((cur) => cur.filter((t) => t.id !== id));
        setCriticalInstances((cur) => cur.filter((ci) => ci.taskId !== id));
        await sb().rpc('delete_critical_task', { p_id: id });
      },
      completeCritical: async (id) => {
        setCriticalInstances((cur) => cur.map((ci) => (ci.id === id ? { ...ci, status: 'done', doneAt: new Date().toISOString() } : ci)));
        await sb().rpc('complete_critical', { p_id: id });
        await load();
      },
      cancelCritical: async (id) => {
        setCriticalInstances((cur) => cur.map((ci) => (ci.id === id ? { ...ci, status: 'canceled' } : ci)));
        await sb().rpc('cancel_critical', { p_id: id });
        await load();
      },
      addListItem: async (text) => {
        const t = text.trim();
        if (!t) return;
        setListItems((cur) => [{ id: `tmp${Date.now()}`, text: t, addedByKid: role === 'kid' ? identity.kidId ?? undefined : undefined, createdAt: new Date().toISOString() }, ...cur]);
        const { error: e } = await sb().rpc('add_list_item', { p_text: t });
        if (e) setError(`Couldn’t add to the list: ${e.message}`);
        await load();
      },
      setListItemDone: async (id, done) => {
        setListItems((cur) => cur.map((x) => (x.id === id ? { ...x, doneAt: done ? new Date().toISOString() : undefined } : x)));
        await sb().from('list_items').update({ done_at: done ? new Date().toISOString() : null, done_by: identity.session?.user.id ?? null }).eq('id', id);
      },
      removeListItem: async (id) => {
        setListItems((cur) => cur.filter((x) => x.id !== id));
        await sb().from('list_items').delete().eq('id', id);
      },
      recordMoney: async (kidId, cents, kind, note) => {
        setMoneyLedger((cur) => [{ id: `tmp${Date.now()}`, kidId, cents, kind, note, createdAt: new Date().toISOString() }, ...cur]);
        const { error: e } = await sb().rpc('record_money', { p_kid: kidId, p_cents: cents, p_kind: kind, p_note: note ?? null });
        if (e) setError(`Money entry failed: ${e.message}`);
        await load();
      },
      resolveUnlockRequest: async (id, grant) => {
        setUnlockRequests((cur) => cur.map((r) => (r.id === id ? { ...r, status: grant ? 'granted' : 'denied', resolvedAt: new Date().toISOString() } : r)));
        const { error: e } = await sb().rpc('resolve_unlock_request', { p_id: id, p_grant: grant });
        if (e) setError(`Couldn’t answer the request: ${e.message}`);
        await load();
      },
      setGrounding: async (kidId, until, reason) => {
        setKids((cur) => cur.map((k) => (k.id === kidId ? { ...k, groundedUntil: until ?? undefined, groundedReason: until ? reason : undefined } : k)));
        const { error: e } = await sb().rpc('set_grounding', { p_kid: kidId, p_until: until, p_reason: reason ?? null });
        if (e) { setError(`Grounding didn’t save: ${e.message}`); await load(); }
      },
      setBedtime: async (kidId, w) => {
        const pair = !!w?.startWeekend && !!w.endWeekend;
        setKids((cur) => cur.map((k) => (k.id === kidId
          ? { ...k, bedStart: w?.start, bedEnd: w?.end, bedStartWeekend: pair ? w!.startWeekend : undefined, bedEndWeekend: pair ? w!.endWeekend : undefined, bedOffDate: w ? k.bedOffDate : undefined }
          : k)));
        const { error: e } = await sb().rpc('set_bedtime', {
          p_kid: kidId, p_start: w?.start ?? null, p_end: w?.end ?? null,
          p_start_weekend: pair ? w!.startWeekend : null, p_end_weekend: pair ? w!.endWeekend : null,
        });
        if (e) { setError(`Bedtime didn’t save: ${e.message}`); await load(); }
      },
      skipBedtime: async (kidId, skip) => {
        setKids((cur) => cur.map((k) => (k.id === kidId ? { ...k, bedOffDate: skip ? bedtimeNow(k).evening : undefined } : k)));
        const { error: e } = await sb().rpc('skip_bedtime', { p_kid: kidId, p_skip: skip });
        if (e) { setError(`Bedtime change didn’t save: ${e.message}`); await load(); }
      },
      saveChore: async (chore, refMedia) => {
        // Reference photos: keep the paths still listed on the draft, append new uploads, cap at 5.
        let refPaths = (chore.refPaths ?? []).slice(0, 5);
        if (refMedia?.length) {
          try {
            const added = await Promise.all(refMedia.slice(0, 5 - refPaths.length).map((m) =>
              uploadProof(`${identity.familyId}/chores/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${m.ext}`, m)));
            refPaths = [...refPaths, ...added];
          } catch (e2) { setError((e2 as Error).message); }
        }
        const row = { family_id: identity.familyId, name: chore.name, emoji: chore.emoji, instruction: chore.instruction || null, recurrence: chore.recurrence, days: chore.days, rotation: chore.rotation, due_time: chore.dueTime || null, overdue: chore.dueTime ? chore.overdue : (chore.overdue === 'rollover' ? 'rollover' : 'block'), required: chore.required, photo_proof: chore.photoProof, ref_paths: refPaths.length ? refPaths : null, group_id: chore.groupId ?? null };
        const { data, error: e } = chore.id
          ? await sb().from('chores').update(row).eq('id', chore.id).select('id').single()
          : await sb().from('chores').insert(row).select('id').single();
        if (e || !data) { setError(e?.message ?? 'save failed'); return; }
        await sb().from('chore_assignments').delete().eq('chore_id', data.id);
        if (chore.kidIds.length) await sb().from('chore_assignments').insert(chore.kidIds.map((kid_id) => ({ chore_id: data.id, kid_id })));
        const touched = new Set([...chore.kidIds, ...(chore.groupId ? groups.find((g) => g.id === chore.groupId)?.kidIds ?? [] : [])]);
        await Promise.all([...touched].map((k) => sb().rpc('ensure_today', { p_kid: k })));
        await load();
      },
      saveGroup: async (g, choreIds) => {
        const { data, error: e } = g.id
          ? await sb().from('chore_groups').update({ name: g.name, emoji: g.emoji }).eq('id', g.id).select('id').single()
          : await sb().from('chore_groups').insert({ family_id: identity.familyId, name: g.name, emoji: g.emoji }).select('id').single();
        if (e || !data) { setError(e?.message ?? 'save failed'); return; }
        await sb().from('chore_group_kids').delete().eq('group_id', data.id);
        if (g.kidIds.length) await sb().from('chore_group_kids').insert(g.kidIds.map((kid_id, position) => ({ group_id: data.id, kid_id, position })));
        // Membership: set group_id on the chosen chores, clear it on ones removed from the list.
        if (choreIds.length) await sb().from('chores').update({ group_id: data.id }).in('id', choreIds);
        await sb().from('chores').update({ group_id: null }).eq('group_id', data.id).not('id', 'in', `(${(choreIds.length ? choreIds : ['00000000-0000-0000-0000-000000000000']).join(',')})`);
        await Promise.all(g.kidIds.map((k) => sb().rpc('ensure_today', { p_kid: k })));
        await load();
      },
      deleteGroup: async (id) => {
        setGroups((cur) => cur.filter((g) => g.id !== id));
        await sb().from('chores').update({ group_id: null }).eq('group_id', id);
        await sb().from('chore_groups').delete().eq('id', id);
        await load();
      },
      advanceGroup: async (id) => {
        const g = groups.find((x) => x.id === id);
        if (!g) return;
        setGroups((cur) => cur.map((x) => (x.id === id ? { ...x, rotationIndex: x.rotationIndex + 1 } : x)));
        await sb().from('chore_groups').update({ rotation_index: g.rotationIndex + 1 }).eq('id', id);
        await load();
      },
      handoffToday: async (from, to) => {
        const { error: e } = await sb().rpc('handoff_today', { p_from: from, p_to: to });
        if (e) setError(`Hand-off didn’t save: ${e.message}`);
        await load();
      },
      saveQuest: async (q: QuestDraft) => {
        const row = { family_id: identity.familyId, title: q.title, note: q.note || null, points: q.points, cents: q.cents ?? null, kid_id: q.kidId, status: q.kidId ? 'claimed' : 'open' };
        const { data, error: e } = q.id
          ? await sb().from('side_quests').update({ title: q.title, note: q.note || null, points: q.points, cents: q.cents ?? null, kid_id: q.kidId }).eq('id', q.id).select('id, prompt_paths').single()
          : await sb().from('side_quests').insert(row).select('id, prompt_paths').single();
        if (e || !data) { setError(e?.message ?? 'save failed'); return; }
        if (q.promptMedia.length) {
          try {
            const existing: string[] = (data.prompt_paths as string[] | null) ?? [];
            const added = await Promise.all(q.promptMedia.map((m, n) =>
              uploadProof(`${identity.familyId}/quests/${data.id}-${existing.length + n}.${m.ext}`, m)));
            await sb().from('side_quests').update({ prompt_paths: [...existing, ...added] }).eq('id', data.id);
          } catch (e2) { setError((e2 as Error).message); }
        }
        await load();
      },
      claimQuest: async (id) => {
        setQuests((cur) => cur.map((q) => (q.id === id ? { ...q, kidId: identity.kidId, status: 'claimed' } : q)));
        await sb().from('side_quests').update({ kid_id: identity.kidId, status: 'claimed', claimed_at: new Date().toISOString() }).eq('id', id).eq('status', 'open');
      },
      submitQuest: async (id, media, note) => {
        const path = `${identity.familyId ?? 'f'}/${identity.kidId ?? currentKidId}/quests/${id}.${media.ext}`;
        try { await uploadProof(path, media); } catch (e) { setError((e as Error).message); return; }
        setQuests((cur) => cur.map((q) => (q.id === id ? { ...q, status: 'submitted', proofUrl: media.previewUrl, proofIsVideo: media.isVideo, proofNote: note } : q)));
        await sb().from('side_quests').update({ status: 'submitted', proof_path: path, proof_note: note ?? null, submitted_at: new Date().toISOString() }).eq('id', id);
      },
      reviewQuest: async (id, ok, reason) => {
        setQuests((cur) => cur.map((q) => (q.id === id ? { ...q, status: ok ? 'approved' : 'rejected', rejectionReason: ok ? undefined : reason } : q)));
        await sb().from('side_quests').update({ status: ok ? 'approved' : 'rejected', rejection_reason: ok ? null : reason ?? null, reviewed_at: new Date().toISOString(), reviewed_by: identity.session?.user.id }).eq('id', id);
      },
      saveReward: async (r) => {
        if (r.id) await sb().from('rewards').update({ title: r.title, emoji: r.emoji, points: r.points }).eq('id', r.id);
        else await sb().from('rewards').insert({ family_id: identity.familyId, title: r.title, emoji: r.emoji, points: r.points });
        await load();
      },
      deleteReward: async (id) => {
        setRewards((cur) => cur.filter((r) => r.id !== id));
        await sb().from('rewards').update({ archived: true }).eq('id', id);
      },
      redeemReward: async (rewardId) => {
        await sb().from('reward_claims').insert({ reward_id: rewardId, kid_id: identity.kidId ?? currentKidId });
        await load();
      },
      resolveClaim: async (id, grant) => {
        setRewardClaims((cur) => cur.map((c) => (c.id === id ? { ...c, status: grant ? 'granted' : 'denied' } : c)));
        await sb().from('reward_claims').update({ status: grant ? 'granted' : 'denied', resolved_at: new Date().toISOString(), resolved_by: identity.session?.user.id }).eq('id', id);
        await load();
      },
      updateSettings: async (patch) => {
        setSettings((s) => ({ ...s, ...patch }));
        await sb().from('families').update({
          ...(patch.resetTime && { reset_time: patch.resetTime }),
          ...(patch.autoApprove !== undefined && { auto_approve: patch.autoApprove }),
          ...('streakRewardDays' in patch && { streak_reward_days: patch.streakRewardDays ?? null }),
          ...('streakRewardCents' in patch && { streak_reward_cents: patch.streakRewardCents ?? null }),
          ...('nightStart' in patch && { night_start: patch.nightStart ?? null }),
          ...('nightEnd' in patch && { night_end: patch.nightEnd ?? null }),
          ...('nightThresholdMin' in patch && { night_threshold_min: patch.nightThresholdMin ?? 15 }),
        }).eq('id', identity.familyId!);
      },
      addDevice: async (dev) => {
        await sb().from('devices').insert({ kid_id: dev.kidId, family_id: dev.kidId ? null : identity.familyId, name: dev.name, platform: dev.platform, identifier: dev.identifier });
        await load();
      },
      updateDevice: async (id, patch) => {
        setDevices((cur) => cur.map((dv) => (dv.id === id ? { ...dv, ...patch } : dv)));
        await sb().from('devices').update({
          ...(patch.override !== undefined && { override: patch.override }),
          ...(patch.scheduleStart !== undefined && { schedule_start: patch.scheduleStart || null }),
          ...(patch.scheduleEnd !== undefined && { schedule_end: patch.scheduleEnd || null }),
        }).eq('id', id);
      },
      removeDevice: async (id) => {
        setDevices((cur) => cur.filter((dv) => dv.id !== id));
        await sb().from('devices').delete().eq('id', id);
      },
      addKid: async (kid) => {
        await sb().from('kids').insert({ family_id: identity.familyId, name: kid.name, age: kid.age, avatar_color: kid.avatarColor });
        await load();
      },
      removeKid: async (kidId) => {
        setKids((cur) => cur.filter((k) => k.id !== kidId));
        await sb().from('kids').delete().eq('id', kidId);
        await load();
      },
      signOut: async () => { await sb().auth.signOut(); },
      reload: load,
    };
  }, [role, currentKidId, kids, chores, groups, instances, quests, devices, settings, parents, rewards, rewardClaims, summons, criticalTasks, criticalInstances, unlockRequests, listItems, moneyLedger, nightEvents, loading, error, identity, load, uploadProof, tick]);

  // Push lock state + per-state shield content to the native shield whenever either
  // changes (kid devices only). Content changes while still locked (a chore approved,
  // a critical escalating) re-apply too, so the shield copy stays current.
  useEffect(() => {
    if (role !== 'kid' || !identity.kidId || loading) return;
    const st = store.kidLockState(identity.kidId);
    const kid = kids.find((k) => k.id === identity.kidId);
    const content = kid ? buildShieldContent(kid, chores, instances, criticalTasks, criticalInstances, unlockRequests) : undefined;
    // Bedtime hand-off for the monitor extension: the state to restore when tonight's
    // window closes (computed without bedtime), and whether a grounding/critical lock
    // currently owns the shield copy so the bedtime start must not repaint it.
    const extras = kid?.bedStart ? {
      afterBedtime: {
        enabled: store.kidLockState(identity.kidId, { ignoreBedtime: true }) === 'locked',
        ...(buildShieldContent({ ...kid, bedStart: undefined, bedEnd: undefined }, chores, instances, criticalTasks, criticalInstances, unlockRequests) ?? RESET_SHIELD),
      },
      bedtimeSuppressed: isGrounded(kid) || criticalLocked(criticalTasks, criticalInstances, kid.id),
    } : undefined;
    const sig = JSON.stringify([st, content, extras]);
    if (sig !== lastApplied.current) { lastApplied.current = sig; void applyLockState(st, content, extras); }
  }, [role, identity.kidId, loading, store, kids, chores, instances, criticalTasks, criticalInstances, unlockRequests]);

  // Keep the native bedtime schedules on the kid device in sync with the kid's window.
  // Per-slot copy is substituted here (the extension only renders); "stay up tonight"
  // rides along as the evening to skip.
  const me = kids.find((k) => k.id === identity.kidId);
  const bedKey = JSON.stringify([me?.bedStart, me?.bedEnd, me?.bedStartWeekend, me?.bedEndWeekend, me?.bedOffDate, me?.name]);
  useEffect(() => {
    if (role !== 'kid' || !Capacitor.isNativePlatform() || loading || !me) return;
    const slot = (start: string, end: string): BedtimeSlot => {
      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      return { startHour: sh, startMinute: sm, endHour: eh, endMinute: em, title: `Goodnight, ${me.name} 🌙`, subtitle: `Screens are back at ${fmtClock(end)}.` };
    };
    const on = !!me.bedStart && !!me.bedEnd;
    void ScreenTime.configureBedtime({
      enabled: on,
      weekday: on ? slot(me.bedStart!, me.bedEnd!) : undefined,
      weekend: on && me.bedStartWeekend && me.bedEndWeekend ? slot(me.bedStartWeekend, me.bedEndWeekend) : undefined,
      skipEvening: me.bedOffDate,
      allowRequest: true,
    }).then((r) => { if (on && r.scheduled === 0) console.warn('[ScreenTime] configureBedtime registered nothing'); })
      .catch((e) => console.warn('[ScreenTime] configureBedtime failed', e)); // older native build without the method
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, loading, bedKey]);

  // Native safety net for critical-task escalation: hand the upcoming lock moments
  // to DeviceActivity so iOS engages the shield on time even when no push arrives
  // (silent pushes throttle; a force-quit app never background-wakes). The set is
  // replaced on every change; completed/canceled rounds drop out on reconcile.
  const lastCriticalLocks = useRef<string | null>(null);
  useEffect(() => {
    if (role !== 'kid' || !identity.kidId || loading || !Capacitor.isNativePlatform()) return;
    const me = kids.find((k) => k.id === identity.kidId);
    const away = !!me?.absentUntil;
    const locks = criticalInstances
      .filter((ci) => ci.status === 'open' || ci.status === 'scheduled')
      .flatMap((ci) => {
        const t = criticalTasks.find((x) => x.id === ci.taskId);
        if (!t) return [];
        const due = new Date(ci.dueAt).getTime();
        if (ci.kidId === identity.kidId)
          return [{ at: due + t.lockAfterMin * 60_000, title: `${t.emoji} ${ci.title}`, subtitle: 'Nothing unlocks until this one’s done.' }];
        // Someone else's round: my device locks at the everyone-locks mark (away kids exempt).
        return away ? [] : [{ at: due + t.lockAllAfterMin * 60_000, title: `${t.emoji} ${ci.title}`, subtitle: 'Everyone is locked until this is done.' }];
      })
      .filter((l) => l.at > Date.now() + 5_000)
      .sort((a, b) => a.at - b.at)
      .slice(0, 6) // DeviceActivity caps concurrent monitors; 6 + reset/night/wake + up to 7 bedtime slots stays under 20
      .map((l) => ({ at: Math.floor(l.at / 1000), title: l.title, subtitle: l.subtitle }));
    const sig = JSON.stringify(locks);
    if (sig === lastCriticalLocks.current) return;
    lastCriticalLocks.current = sig;
    ScreenTime.scheduleCriticalLocks({ locks }).catch(() => {}); // older native build without the method
  }, [role, identity.kidId, loading, criticalInstances, criticalTasks, kids]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
