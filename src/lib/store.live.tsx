/**
 * Supabase-backed store. Same `Store` interface as the mock so screens don't change.
 *
 * Parent: email/password session -> parents row -> family.
 * Kid:    anonymous session -> kid_users row (via join_as_kid RPC) -> one kid.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { blocksNow, Ctx, type QuestDraft, type Role, type Store } from './store';
import type { Chore, ChoreInstance, Device, FamilyParent, Kid, LockState, ProofMedia, Reward, RewardClaim, Settings, SideQuest } from './types';
import { applyLockState } from '../native/screenTime';
import { Capacitor } from '@capacitor/core';
import { installId, setupPush } from '../native/push';
import ScreenTime from '../native/screenTime';

const sb = () => supabase!;
const fmtTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : undefined);
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
  const [instances, setInstances] = useState<ChoreInstance[]>([]);
  const [quests, setQuests] = useState<SideQuest[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [parents, setParents] = useState<FamilyParent[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [rewardClaims, setRewardClaims] = useState<RewardClaim[]>([]);
  const [settings, setSettings] = useState<Settings>({ resetTime: '00:00', autoApprove: false, routerStatus: 'none' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentKidId, setCurrentKidId] = useState(identity.kidId ?? '');
  const [tick, setTick] = useState(0); // minute pulse so due-time lock flips re-evaluate while open
  const lastApplied = useRef<LockState | null>(null);

  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);

  const load = useCallback(async () => {
    try {
      setError(null);
      const kidIds = role === 'kid' ? [identity.kidId!] : null;
      // Ensure today's instances exist (idempotent) before reading.
      const { data: kidRows, error: ke } = kidIds
        ? await sb().from('kids').select('*').in('id', kidIds)
        : await sb().from('kids').select('*').eq('family_id', identity.familyId!).order('created_at');
      if (ke) throw ke;
      await Promise.all((kidRows ?? []).map((k) => sb().rpc('ensure_today', { p_kid: k.id })));

      const [fam, invite, pars, rw, rc, ch, asg, inst, qs, dev, pts, streaks] = await Promise.all([
        sb().from('families').select('*').single(),
        role === 'parent' ? sb().from('parent_invites').select('code').maybeSingle() : Promise.resolve({ data: null }),
        role === 'parent' ? sb().from('family_parents').select('*') : Promise.resolve({ data: [] }),
        sb().from('rewards').select('*').eq('archived', false).order('points'),
        sb().from('reward_claims').select('*').order('requested_at', { ascending: false }),
        sb().from('chores').select('*').eq('archived', false),
        sb().from('chore_assignments').select('*'),
        sb().from('chore_instances').select('*').in('kid_id', (kidRows ?? []).map((k) => k.id)),
        sb().from('side_quests').select('*').order('created_at', { ascending: false }),
        sb().from('devices').select('*'),
        sb().from('kid_points').select('*'),
        Promise.all((kidRows ?? []).map((k) => sb().rpc('kid_streak', { p_kid: k.id }).then((r) => [k.id, r.data ?? 0] as const))),
      ]);
      const streakMap = Object.fromEntries(streaks);
      const pointsMap = Object.fromEntries((pts.data ?? []).map((p) => [p.kid_id, p.points]));
      // Only today's instances (family-local date comes back from ensure_today, but filter by max date).
      const todayStr = (inst.data ?? []).reduce((m, i) => (i.date > m ? i.date : m), '');
      const todays = (inst.data ?? []).filter((i) => i.date === todayStr);

      setSettings({ resetTime: fam.data?.reset_time?.slice(0, 5) ?? '00:00', autoApprove: fam.data?.auto_approve ?? false, routerStatus: 'none', parentCode: invite.data?.code ?? undefined });
      setChores((ch.data ?? []).map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, instruction: c.instruction ?? undefined, recurrence: c.recurrence, days: c.days ?? [], rotation: c.rotation ?? 'none', dueTime: c.due_time ? c.due_time.slice(0, 5) : undefined, required: c.required, photoProof: c.photo_proof, proofType: c.proof_type ?? 'photo', kidIds: (asg.data ?? []).filter((a) => a.chore_id === c.id).map((a) => a.kid_id) })));
      setKids((kidRows ?? []).map((k) => ({ id: k.id, name: k.name, age: k.age ?? 0, avatarColor: k.avatar_color, lockState: 'unknown', streakDays: streakMap[k.id] ?? 0, points: pointsMap[k.id] ?? 0, override: k.override_date === todayStr ? k.override : null, absentUntil: k.absent_until && k.absent_until >= todayStr ? k.absent_until : undefined, joinCode: k.join_code ?? undefined })));
      setInstances(await Promise.all(todays.map(async (i) => ({
        id: i.id, choreId: i.chore_id, kidId: i.kid_id, date: i.date, status: i.status, attempt: i.attempt,
        photoUrl: await signed(i.photo_path), videoUrl: await signed(i.video_path),
        note: i.note ?? undefined, submittedAt: fmtTime(i.submitted_at), rejectionReason: i.rejection_reason ?? undefined,
      }))));
      setRewards((rw.data ?? []).map((r) => ({ id: r.id, title: r.title, emoji: r.emoji, points: r.points })));
      setRewardClaims((rc.data ?? []).map((c) => ({ id: c.id, rewardId: c.reward_id, kidId: c.kid_id, status: c.status })));
      setQuests(await Promise.all((qs.data ?? []).map(async (q) => ({
        id: q.id, title: q.title, note: q.note ?? undefined, points: q.points, kidId: q.kid_id,
        status: q.status, promptUrls: (await Promise.all(((q.prompt_paths ?? []) as string[]).map(signed))).filter((u): u is string => !!u),
        proofUrl: await signed(q.proof_path), proofIsVideo: isVideoPath(q.proof_path),
        proofNote: q.proof_note ?? undefined, rejectionReason: q.rejection_reason ?? undefined, submittedAt: fmtTime(q.submitted_at),
      }))));
      setDevices((dev.data ?? []).map((d) => ({ id: d.id, kidId: d.kid_id, name: d.name, platform: d.platform, identifier: d.identifier, lastSeen: d.last_seen ?? undefined, blocked: false, override: d.override ?? null, scheduleStart: d.schedule_start ? d.schedule_start.slice(0, 5) : undefined, scheduleEnd: d.schedule_end ? d.schedule_end.slice(0, 5) : undefined })));
      setParents((pars.data ?? []).map((p: { user_id: string; display_name: string | null; email: string | null }) => ({ userId: p.user_id, name: p.display_name ?? undefined, email: p.email ?? undefined, isMe: p.user_id === identity.session?.user.id })));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [role, identity.kidId, identity.familyId]);

  useEffect(() => { void load(); }, [load]);

  // Realtime: any change to instances/kids/quests in scope -> reload.
  useEffect(() => {
    const chan = sb().channel('chorelock')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chore_instances' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kids' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'side_quests' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reward_claims' }, () => void load())
      .subscribe();
    const onVis = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { sb().removeChannel(chan); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

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
    void ScreenTime.scheduleDailyReset({ hour: h, minute: m }).catch(() => {});
  }, [role, loading, settings.resetTime]);

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
    const kidLockState = (kidId: string): LockState => {
      if (error) return 'unknown';
      const kid = kids.find((k) => k.id === kidId);
      if (kid?.absentUntil) return 'unlocked';
      if (kid?.override === 'unlock') return 'unlocked';
      if (kid?.override === 'lock') return 'locked';
      return instances.some((i) => i.kidId === kidId && blocksNow(i, chores.find((c) => c.id === i.choreId))) ? 'locked' : 'unlocked';
    };
    const allClear = kids.length > 0 && kids.every((k) => kidLockState(k.id) === 'unlocked');
    const devicesWithState = devices.map((d) => ({ ...d, blocked: d.override === 'unlock' ? false : d.override === 'lock' ? true : d.kidId ? kidLockState(d.kidId) === 'locked' : !allClear }));

    return {
      role, setRole: () => {}, currentKidId, setCurrentKidId,
      kids, chores, instances, quests, devices: devicesWithState, settings, parents, rewards, rewardClaims, loading, error,
      kidLockState, requiredProgress,
      pendingCount: instances.filter((i) => i.status === 'submitted').length + quests.filter((q) => q.status === 'submitted').length + rewardClaims.filter((c) => c.status === 'requested').length,
      submit: async (id, proof, note) => {
        const inst = instances.find((i) => i.id === id)!;
        const kid = kids.find((k) => k.id === inst.kidId)!;
        const base = `${identity.familyId ?? 'f'}/${kid.id}/${inst.date}/${inst.choreId}-${inst.attempt}`;
        let photoPath: string | null = null, videoPath: string | null = null;
        try {
          if (proof.photo) photoPath = await uploadProof(`${base}.${proof.photo.ext}`, proof.photo);
          if (proof.video) videoPath = await uploadProof(`${base}-v.${proof.video.ext}`, proof.video);
        } catch (e) { setError((e as Error).message); return; }
        setInstances((cur) => cur.map((i) => (i.id === id ? { ...i, status: 'submitted', photoUrl: proof.photo?.previewUrl, videoUrl: proof.video?.previewUrl, note } : i)));
        // Always 'submitted' — a server trigger auto-approves first attempts when the family setting is on.
        await sb().from('chore_instances').update({ status: 'submitted', ...(photoPath && { photo_path: photoPath }), ...(videoPath && { video_path: videoPath }), note: note ?? null, submitted_at: new Date().toISOString() }).eq('id', id);
      },
      approve: async (id) => {
        setInstances((cur) => cur.map((i) => (i.id === id ? { ...i, status: 'approved', rejectionReason: undefined } : i)));
        await sb().from('chore_instances').update({ status: 'approved', rejection_reason: null, reviewed_at: new Date().toISOString(), reviewed_by: identity.session?.user.id }).eq('id', id);
      },
      reject: async (id, reason) => {
        setInstances((cur) => cur.map((i) => (i.id === id ? { ...i, status: 'rejected', rejectionReason: reason, attempt: i.attempt + 1 } : i)));
        const inst = instances.find((i) => i.id === id)!;
        await sb().from('chore_instances').update({ status: 'rejected', rejection_reason: reason, attempt: inst.attempt + 1, reviewed_at: new Date().toISOString(), reviewed_by: identity.session?.user.id }).eq('id', id);
      },
      reopen: async (id) => {
        setInstances((cur) => cur.map((i) => (i.id === id ? { ...i, status: 'todo', rejectionReason: undefined } : i)));
        await sb().from('chore_instances').update({ status: 'todo', rejection_reason: null, reviewed_at: new Date().toISOString(), reviewed_by: identity.session?.user.id }).eq('id', id);
      },
      override: async (kidId, mode) => {
        setKids((cur) => cur.map((k) => (k.id === kidId ? { ...k, override: mode } : k)));
        await sb().rpc('set_override', { p_kid: kidId, mode });
      },
      setAbsent: async (kidId, until) => {
        setKids((cur) => cur.map((k) => (k.id === kidId ? { ...k, absentUntil: until ?? undefined } : k)));
        await sb().from('kids').update({ absent_until: until }).eq('id', kidId);
      },
      saveChore: async (chore) => {
        const row = { family_id: identity.familyId, name: chore.name, emoji: chore.emoji, instruction: chore.instruction || null, recurrence: chore.recurrence, days: chore.days, rotation: chore.rotation, due_time: chore.dueTime || null, required: chore.required, photo_proof: chore.photoProof };
        const { data, error: e } = chore.id
          ? await sb().from('chores').update(row).eq('id', chore.id).select('id').single()
          : await sb().from('chores').insert(row).select('id').single();
        if (e || !data) { setError(e?.message ?? 'save failed'); return; }
        await sb().from('chore_assignments').delete().eq('chore_id', data.id);
        await sb().from('chore_assignments').insert(chore.kidIds.map((kid_id) => ({ chore_id: data.id, kid_id })));
        await Promise.all(chore.kidIds.map((k) => sb().rpc('ensure_today', { p_kid: k })));
        await load();
      },
      saveQuest: async (q: QuestDraft) => {
        const row = { family_id: identity.familyId, title: q.title, note: q.note || null, points: q.points, kid_id: q.kidId, status: q.kidId ? 'claimed' : 'open' };
        const { data, error: e } = q.id
          ? await sb().from('side_quests').update({ title: q.title, note: q.note || null, points: q.points, kid_id: q.kidId }).eq('id', q.id).select('id, prompt_paths').single()
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
        await sb().from('side_quests').update({ status: ok ? 'approved' : 'rejected', rejection_reason: ok ? null : reason ?? null, reviewed_at: new Date().toISOString() }).eq('id', id);
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
        await sb().from('reward_claims').update({ status: grant ? 'granted' : 'denied', resolved_at: new Date().toISOString() }).eq('id', id);
        await load();
      },
      updateSettings: async (patch) => {
        setSettings((s) => ({ ...s, ...patch }));
        await sb().from('families').update({ ...(patch.resetTime && { reset_time: patch.resetTime }), ...(patch.autoApprove !== undefined && { auto_approve: patch.autoApprove }) }).eq('id', identity.familyId!);
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
    };
  }, [role, currentKidId, kids, chores, instances, quests, devices, settings, parents, rewards, rewardClaims, loading, error, identity, load, uploadProof, tick]);

  // Push lock state to the native shield whenever it changes (kid devices only).
  useEffect(() => {
    if (role !== 'kid' || !identity.kidId || loading) return;
    const st = store.kidLockState(identity.kidId);
    if (st !== lastApplied.current) { lastApplied.current = st; void applyLockState(st); }
  }, [role, identity.kidId, loading, store]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
