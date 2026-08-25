/**
 * App state. Ships with an in-memory mock matching the handoff's sample family so
 * every screen renders without a backend. Swap `api` for the Supabase client in
 * src/lib/supabase.ts once the project is created — the shape is identical.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Chore, ChoreInstance, Device, Kid, LockState, ProofMedia, Settings, SideQuest } from './types';
import { applyLockState } from '../native/screenTime';

export const today = () => new Date().toISOString().slice(0, 10);

/** True when a required instance blocks Wi-Fi right now (due-time aware). */
export const blocksNow = (i: ChoreInstance, c: Chore | undefined) => {
  if (!c?.required || i.status === 'approved') return false;
  if (c.dueTime) {
    const [h, m] = c.dueTime.split(':').map(Number);
    const due = new Date(); due.setHours(h, m, 0, 0);
    if (new Date() < due) return false;
  }
  return true;
};

const KIDS: Kid[] = [
  { id: 'k1', name: 'Tenleigh', age: 15, avatarColor: '#0D9488', lockState: 'unlocked', streakDays: 12, points: 25, override: null },
  { id: 'k2', name: 'Taegyn', age: 13, avatarColor: '#B45309', lockState: 'locked', streakDays: 3, points: 10, override: null },
  { id: 'k3', name: 'Dawson', age: 9, avatarColor: '#5B5BD6', lockState: 'locked', streakDays: 5, points: 40, override: null },
];

const CHORES: Chore[] = [
  { id: 'c1', name: 'Feed the dog', emoji: '🐶', instruction: 'Show the full bowl', kidIds: ['k3'], recurrence: 'daily', days: [], rotation: 'none', required: true, photoProof: true },
  { id: 'c2', name: 'Unload dishwasher', emoji: '🍽️', instruction: 'Show the empty dishwasher', kidIds: ['k3', 'k2'], recurrence: 'daily', days: [], rotation: 'daily', required: true, photoProof: true },
  { id: 'c3', name: 'Make your bed', emoji: '🛏️', instruction: 'Show the whole bed', kidIds: ['k1', 'k2', 'k3'], recurrence: 'daily', days: [], rotation: 'none', required: true, photoProof: true },
  { id: 'c4', name: 'Take out trash', emoji: '🗑️', kidIds: ['k3'], recurrence: 'weekdays', days: [], rotation: 'none', required: true, photoProof: true, dueTime: '17:00' },
  { id: 'c5', name: 'Water the plants', emoji: '🪴', kidIds: ['k3'], recurrence: 'daily', days: [], rotation: 'none', required: false, photoProof: true },
  { id: 'c6', name: 'Vacuum living room', emoji: '🧹', kidIds: ['k1'], recurrence: 'custom', days: [1, 4], rotation: 'none', required: true, photoProof: true },
];

const d = today();
const INSTANCES: ChoreInstance[] = [
  { id: 'i1', choreId: 'c1', kidId: 'k3', date: d, status: 'submitted', attempt: 1, submittedAt: '16:32', note: 'He ate it all already lol' },
  { id: 'i2', choreId: 'c2', kidId: 'k3', date: d, status: 'todo', attempt: 1 },
  { id: 'i3', choreId: 'c3', kidId: 'k3', date: d, status: 'rejected', attempt: 1, rejectionReason: 'Pillows on the floor — redo it, please' },
  { id: 'i4', choreId: 'c4', kidId: 'k3', date: d, status: 'approved', attempt: 1 },
  { id: 'i5', choreId: 'c5', kidId: 'k3', date: d, status: 'todo', attempt: 1 },
  { id: 'i6', choreId: 'c2', kidId: 'k2', date: d, status: 'submitted', attempt: 2, submittedAt: '15:10' },
  { id: 'i7', choreId: 'c3', kidId: 'k2', date: d, status: 'approved', attempt: 1 },
  { id: 'i8', choreId: 'c3', kidId: 'k1', date: d, status: 'approved', attempt: 1 },
  { id: 'i9', choreId: 'c6', kidId: 'k1', date: d, status: 'approved', attempt: 1 },
];

const QUESTS: SideQuest[] = [
  { id: 'q1', title: 'Wipe down the patio table', note: 'Before grandma visits Saturday', points: 10, kidId: null, status: 'open' },
  { id: 'q2', title: 'Pull weeds by the mailbox', points: 15, kidId: 'k3', status: 'claimed' },
];

const DEVICES: Device[] = [
  { id: 'd1', kidId: 'k1', name: 'Tenleigh’s iPhone', platform: 'ios', identifier: 'ios-8f2a', blocked: false },
  { id: 'd2', kidId: 'k1', name: 'Tenleigh’s iPad', platform: 'ios', identifier: 'ios-1c77', blocked: false },
  { id: 'd3', kidId: 'k2', name: 'Taegyn’s iPhone', platform: 'ios', identifier: 'ios-b03d', blocked: true },
  { id: 'd4', kidId: 'k3', name: 'Dawson’s iPad', platform: 'ios', identifier: 'ios-e915', blocked: true },
  { id: 'd5', kidId: 'k3', name: 'Switch', platform: 'other', identifier: 'A4:C3:F0:12:9B:7E', blocked: true },
];

const SETTINGS: Settings = { resetTime: '00:00', autoApprove: false, routerStatus: 'none', routerModel: 'TP-Link Archer (model TBD)' };

export type Role = 'parent' | 'kid';

export interface QuestDraft {
  id?: string;
  title: string;
  note?: string;
  points: number;
  kidId: string | null;
  promptMedia?: ProofMedia; // parent's photo of the task
}

export interface Store {
  role: Role; setRole: (r: Role) => void;
  currentKidId: string; setCurrentKidId: (id: string) => void;
  kids: Kid[]; chores: Chore[]; instances: ChoreInstance[]; quests: SideQuest[]; devices: Device[]; settings: Settings;
  // derived
  kidLockState: (kidId: string) => LockState;
  requiredProgress: (kidId: string) => { done: number; total: number };
  pendingCount: number;
  // actions
  submit: (instanceId: string, media: ProofMedia, note?: string) => void;
  approve: (instanceId: string) => void;
  reject: (instanceId: string, reason: string) => void;
  override: (kidId: string, mode: 'lock' | 'unlock' | null) => void;
  setAbsent: (kidId: string, until: string | null) => void;
  saveChore: (chore: Omit<Chore, 'id'> & { id?: string }) => void;
  saveQuest: (quest: QuestDraft) => void;
  claimQuest: (questId: string) => void;
  submitQuest: (questId: string, media: ProofMedia, note?: string) => void;
  reviewQuest: (questId: string, approved: boolean, reason?: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  addDevice: (dev: Omit<Device, 'id' | 'blocked'>) => void;
  addKid?: (kid: { name: string; age: number; avatarColor: string }) => Promise<void>;
  removeKid?: (kidId: string) => Promise<void>;
  signOut?: () => Promise<void>;
  loading?: boolean;
  error?: string | null;
}

export const Ctx = createContext<Store | null>(null);

export function MockStoreProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>('kid');
  const [currentKidId, setCurrentKidId] = useState('k3');
  const [kids, setKids] = useState(KIDS);
  const [chores, setChores] = useState(CHORES);
  const [instances, setInstances] = useState(INSTANCES);
  const [quests, setQuests] = useState(QUESTS);
  const [devices, setDevices] = useState(DEVICES);
  const [settings, setSettings] = useState(SETTINGS);

  const store = useMemo<Store>(() => {
    const requiredProgress = (kidId: string) => {
      const req = instances.filter((i) => i.kidId === kidId && chores.find((c) => c.id === i.choreId)?.required);
      return { done: req.filter((i) => i.status === 'approved').length, total: req.length };
    };
    const kidLockState = (kidId: string): LockState => {
      const kid = kids.find((k) => k.id === kidId);
      if (kid?.absentUntil && kid.absentUntil >= today()) return 'unlocked';
      if (kid?.override === 'unlock') return 'unlocked';
      if (kid?.override === 'lock') return 'locked';
      return instances.some((i) => i.kidId === kidId && blocksNow(i, chores.find((c) => c.id === i.choreId))) ? 'locked' : 'unlocked';
    };
    const sync = (kidId: string, next: ChoreInstance[], nextKids = kids) => {
      // Recompute and push to the native shield (no-op on web).
      const kid = nextKids.find((k) => k.id === kidId)!;
      const blocked = next.some((i) => i.kidId === kidId && blocksNow(i, chores.find((c) => c.id === i.choreId)));
      const state: LockState = kid.override === 'unlock' ? 'unlocked' : kid.override === 'lock' ? 'locked' : blocked ? 'locked' : 'unlocked';
      if (kidId === currentKidId) void applyLockState(state);
      setDevices((ds) => ds.map((dv) => (dv.kidId === kidId ? { ...dv, blocked: state === 'locked' } : dv)));
    };

    return {
      role, setRole, currentKidId, setCurrentKidId, kids, chores, instances, quests, devices, settings,
      kidLockState, requiredProgress,
      pendingCount: instances.filter((i) => i.status === 'submitted').length + quests.filter((q) => q.status === 'submitted').length,
      submit: (id, media, note) =>
        setInstances((cur) => {
          const auto = settings.autoApprove && cur.find((i) => i.id === id)!.attempt === 1;
          const next = cur.map((i) => (i.id === id ? { ...i, status: auto ? 'approved' : 'submitted', photoUrl: media.previewUrl, isVideo: media.isVideo, note, submittedAt: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) } as ChoreInstance : i));
          const kidId = cur.find((i) => i.id === id)!.kidId;
          if (auto) sync(kidId, next);
          return next;
        }),
      approve: (id) =>
        setInstances((cur) => {
          const next = cur.map((i) => (i.id === id ? { ...i, status: 'approved' as const, rejectionReason: undefined } : i));
          sync(cur.find((i) => i.id === id)!.kidId, next);
          return next;
        }),
      reject: (id, reason) =>
        setInstances((cur) => {
          const next = cur.map((i) => (i.id === id ? { ...i, status: 'rejected' as const, rejectionReason: reason, attempt: i.attempt + 1 } : i));
          sync(cur.find((i) => i.id === id)!.kidId, next);
          return next;
        }),
      override: (kidId, mode) =>
        setKids((cur) => {
          const next = cur.map((k) => (k.id === kidId ? { ...k, override: mode } : k));
          sync(kidId, instances, next);
          return next;
        }),
      setAbsent: (kidId, until) =>
        setKids((cur) => {
          const next = cur.map((k) => (k.id === kidId ? { ...k, absentUntil: until ?? undefined } : k));
          sync(kidId, instances, next);
          return next;
        }),
      saveChore: (chore) =>
        setChores((cur) => (chore.id ? cur.map((c) => (c.id === chore.id ? { ...c, ...chore, id: c.id } : c)) : [...cur, { ...chore, id: `c${Date.now()}` }])),
      saveQuest: (q) =>
        setQuests((cur) => (q.id
          ? cur.map((x) => (x.id === q.id ? { ...x, title: q.title, note: q.note, points: q.points, kidId: q.kidId, promptUrl: q.promptMedia?.previewUrl ?? x.promptUrl } : x))
          : [...cur, { id: `q${Date.now()}`, title: q.title, note: q.note, points: q.points, kidId: q.kidId, promptUrl: q.promptMedia?.previewUrl, status: q.kidId ? 'claimed' : 'open' }])),
      claimQuest: (id) => setQuests((cur) => cur.map((q) => (q.id === id ? { ...q, kidId: currentKidId, status: 'claimed' } : q))),
      submitQuest: (id, media, note) =>
        setQuests((cur) => cur.map((q) => (q.id === id ? { ...q, status: 'submitted', proofUrl: media.previewUrl, proofIsVideo: media.isVideo, proofNote: note, submittedAt: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) } : q))),
      reviewQuest: (id, ok, reason) =>
        setQuests((cur) => cur.map((q) => (q.id === id ? { ...q, status: ok ? 'approved' : 'rejected', rejectionReason: ok ? undefined : reason } : q))),
      updateSettings: (patch) => setSettings((s) => ({ ...s, ...patch })),
      addDevice: (dev) => setDevices((cur) => [...cur, { ...dev, id: `d${Date.now()}`, blocked: kidLockState(dev.kidId) === 'locked' }]),
    };
  }, [role, currentKidId, kids, chores, instances, quests, devices, settings]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
