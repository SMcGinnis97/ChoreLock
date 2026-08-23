/**
 * Supabase-backed store. Same `Store` interface as the mock so screens don't change.
 *
 * Parent: email/password session -> parents row -> family.
 * Kid:    anonymous session -> kid_users row (via join_as_kid RPC) -> one kid.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { Ctx, type Role, type Store } from './store';
import type { Chore, ChoreInstance, Device, Kid, LockState, Settings } from './types';
import { applyLockState } from '../native/screenTime';
import { Capacitor } from '@capacitor/core';

const sb = () => supabase!;
const fmtTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : undefined);

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
  const [devices, setDevices] = useState<Device[]>([]);
  const [settings, setSettings] = useState<Settings>({ resetTime: '00:00', autoApprove: false, routerStatus: 'none' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentKidId, setCurrentKidId] = useState(identity.kidId ?? '');
  const lastApplied = useRef<LockState | null>(null);

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

      const [fam, ch, asg, inst, dev, streaks] = await Promise.all([
        sb().from('families').select('*').single(),
        sb().from('chores').select('*').eq('archived', false),
        sb().from('chore_assignments').select('*'),
        sb().from('chore_instances').select('*').in('kid_id', (kidRows ?? []).map((k) => k.id)),
        sb().from('devices').select('*'),
        Promise.all((kidRows ?? []).map((k) => sb().rpc('kid_streak', { p_kid: k.id }).then((r) => [k.id, r.data ?? 0] as const))),
      ]);
      const streakMap = Object.fromEntries(streaks);
      // Only today's instances (family-local date comes back from ensure_today, but filter by max date).
      const todayStr = (inst.data ?? []).reduce((m, i) => (i.date > m ? i.date : m), '');
      const todays = (inst.data ?? []).filter((i) => i.date === todayStr);

      setSettings({ resetTime: fam.data?.reset_time?.slice(0, 5) ?? '00:00', autoApprove: fam.data?.auto_approve ?? false, routerStatus: 'none' });
      setChores((ch.data ?? []).map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, instruction: c.instruction ?? undefined, recurrence: c.recurrence, days: c.days ?? [], required: c.required, photoProof: c.photo_proof, kidIds: (asg.data ?? []).filter((a) => a.chore_id === c.id).map((a) => a.kid_id) })));
      setKids((kidRows ?? []).map((k) => ({ id: k.id, name: k.name, age: k.age ?? 0, avatarColor: k.avatar_color, lockState: 'unknown', streakDays: streakMap[k.id] ?? 0, override: k.override_date === todayStr ? k.override : null, joinCode: k.join_code ?? undefined })));
      setInstances(await Promise.all(todays.map(async (i) => {
        let photoUrl: string | undefined;
        if (i.photo_path) { const { data } = await sb().storage.from('proofs').createSignedUrl(i.photo_path, 3600); photoUrl = data?.signedUrl; }
        return { id: i.id, choreId: i.chore_id, kidId: i.kid_id, date: i.date, status: i.status, attempt: i.attempt, photoUrl, note: i.note ?? undefined, submittedAt: fmtTime(i.submitted_at), rejectionReason: i.rejection_reason ?? undefined };
      })));
      setDevices((dev.data ?? []).map((d) => ({ id: d.id, kidId: d.kid_id, name: d.name, platform: d.platform, identifier: d.identifier, lastSeen: d.last_seen ?? undefined, blocked: false })));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [role, identity.kidId, identity.familyId]);

  useEffect(() => { void load(); }, [load]);

  // Realtime: any change to instances/kids in scope -> reload.
  useEffect(() => {
    const chan = sb().channel('chorelock')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chore_instances' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kids' }, () => void load())
      .subscribe();
    const onVis = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { sb().removeChannel(chan); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  // Register this install as a device for the kid (iOS only).
  useEffect(() => {
    if (role !== 'kid' || !identity.kidId || !Capacitor.isNativePlatform()) return;
    const key = 'chorelock.installId';
    const installId = localStorage.getItem(key) ?? crypto.randomUUID().slice(0, 8);
    localStorage.setItem(key, installId);
    void sb().from('devices').upsert({ kid_id: identity.kidId, name: `${navigator.platform || 'iOS'} device`, platform: 'ios', identifier: `ios-${installId}`, last_seen: new Date().toISOString() }, { onConflict: 'kid_id,identifier' });
  }, [role, identity.kidId]);

  const store = useMemo<Store>(() => {
    const requiredProgress = (kidId: string) => {
      const req = instances.filter((i) => i.kidId === kidId && chores.find((c) => c.id === i.choreId)?.required);
      return { done: req.filter((i) => i.status === 'approved').length, total: req.length };
    };
    const kidLockState = (kidId: string): LockState => {
      if (error) return 'unknown';
      const kid = kids.find((k) => k.id === kidId);
      if (kid?.override === 'unlock') return 'unlocked';
      if (kid?.override === 'lock') return 'locked';
      const p = requiredProgress(kidId);
      return p.done === p.total ? 'unlocked' : 'locked';
    };
    const devicesWithState = devices.map((d) => ({ ...d, blocked: kidLockState(d.kidId) === 'locked' }));

    return {
      role, setRole: () => {}, currentKidId, setCurrentKidId,
      kids, chores, instances, devices: devicesWithState, settings, loading, error,
      kidLockState, requiredProgress,
      pendingCount: instances.filter((i) => i.status === 'submitted').length,
      submit: async (id, photoDataUrl, note) => {
        const inst = instances.find((i) => i.id === id)!;
        const kid = kids.find((k) => k.id === inst.kidId)!;
        const blob = await (await fetch(photoDataUrl)).blob();
        const path = `${identity.familyId ?? 'f'}/${kid.id}/${inst.date}/${inst.choreId}-${inst.attempt}.jpg`;
        const { error: ue } = await sb().storage.from('proofs').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
        if (ue) { setError(ue.message); return; }
        setInstances((cur) => cur.map((i) => (i.id === id ? { ...i, status: 'submitted', photoUrl: photoDataUrl, note } : i)));
        await sb().from('chore_instances').update({ status: settings.autoApprove ? 'approved' : 'submitted', photo_path: path, note: note ?? null, submitted_at: new Date().toISOString() }).eq('id', id);
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
      override: async (kidId, mode) => {
        setKids((cur) => cur.map((k) => (k.id === kidId ? { ...k, override: mode } : k)));
        await sb().rpc('set_override', { p_kid: kidId, mode });
      },
      saveChore: async (chore) => {
        const row = { family_id: identity.familyId, name: chore.name, emoji: chore.emoji, instruction: chore.instruction || null, recurrence: chore.recurrence, days: chore.days, required: chore.required, photo_proof: chore.photoProof };
        const { data, error: e } = chore.id
          ? await sb().from('chores').update(row).eq('id', chore.id).select('id').single()
          : await sb().from('chores').insert(row).select('id').single();
        if (e || !data) { setError(e?.message ?? 'save failed'); return; }
        await sb().from('chore_assignments').delete().eq('chore_id', data.id);
        await sb().from('chore_assignments').insert(chore.kidIds.map((kid_id) => ({ chore_id: data.id, kid_id })));
        await Promise.all(chore.kidIds.map((k) => sb().rpc('ensure_today', { p_kid: k })));
        await load();
      },
      updateSettings: async (patch) => {
        setSettings((s) => ({ ...s, ...patch }));
        await sb().from('families').update({ ...(patch.resetTime && { reset_time: patch.resetTime }), ...(patch.autoApprove !== undefined && { auto_approve: patch.autoApprove }) }).eq('id', identity.familyId!);
      },
      addDevice: async (dev) => {
        await sb().from('devices').insert({ kid_id: dev.kidId, name: dev.name, platform: dev.platform, identifier: dev.identifier });
        await load();
      },
      addKid: async (kid) => {
        await sb().from('kids').insert({ family_id: identity.familyId, name: kid.name, age: kid.age, avatar_color: kid.avatarColor });
        await load();
      },
      signOut: async () => { await sb().auth.signOut(); },
    };
  }, [role, currentKidId, kids, chores, instances, devices, settings, loading, error, identity, load]);

  // Push lock state to the native shield whenever it changes (kid devices only).
  useEffect(() => {
    if (role !== 'kid' || !identity.kidId || loading) return;
    const st = store.kidLockState(identity.kidId);
    if (st !== lastApplied.current) { lastApplied.current = st; void applyLockState(st); }
  }, [role, identity.kidId, loading, store]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
