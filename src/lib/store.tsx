/**
 * App state. Ships with an in-memory mock matching the handoff's sample family so
 * every screen renders without a backend. Swap `api` for the Supabase client in
 * src/lib/supabase.ts once the project is created — the shape is identical.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Chore, ChoreInstance, Device, Kid, LockState, Settings } from './types';
import { applyLockState } from '../native/screenTime';

export const today = () => new Date().toISOString().slice(0, 10);

const KIDS: Kid[] = [
  { id: 'k1', name: 'Tenleigh', age: 15, avatarColor: '#0D9488', lockState: 'unlocked', streakDays: 12, override: null },
  { id: 'k2', name: 'Taegyn', age: 13, avatarColor: '#B45309', lockState: 'locked', streakDays: 3, override: null },
  { id: 'k3', name: 'Dawson', age: 9, avatarColor: '#5B5BD6', lockState: 'locked', streakDays: 5, override: null },
];

const CHORES: Chore[] = [
  { id: 'c1', name: 'Feed the dog', emoji: '🐶', instruction: 'Show the full bowl', kidIds: ['k3'], recurrence: 'daily', days: [], required: true, photoProof: true },
  { id: 'c2', name: 'Unload dishwasher', emoji: '🍽️', instruction: 'Show the empty dishwasher', kidIds: ['k3', 'k2'], recurrence: 'daily', days: [], required: true, photoProof: true },
  { id: 'c3', name: 'Make your bed', emoji: '🛏️', instruction: 'Show the whole bed', kidIds: ['k1', 'k2', 'k3'], recurrence: 'daily', days: [], required: true, photoProof: true },
  { id: 'c4', name: 'Take out trash', emoji: '🗑️', kidIds: ['k3'], recurrence: 'weekdays', days: [], required: true, photoProof: true },
  { id: 'c5', name: 'Water the plants', emoji: '🪴', kidIds: ['k3'], recurrence: 'daily', days: [], required: false, photoProof: true },
  { id: 'c6', name: 'Vacuum living room', emoji: '🧹', kidIds: ['k1'], recurrence: 'custom', days: [1, 4], required: true, photoProof: true },
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

const DEVICES: Device[] = [
  { id: 'd1', kidId: 'k1', name: 'Tenleigh’s iPhone', platform: 'ios', identifier: 'ios-8f2a', blocked: false },
  { id: 'd2', kidId: 'k1', name: 'Tenleigh’s iPad', platform: 'ios', identifier: 'ios-1c77', blocked: false },
  { id: 'd3', kidId: 'k2', name: 'Taegyn’s iPhone', platform: 'ios', identifier: 'ios-b03d', blocked: true },
  { id: 'd4', kidId: 'k3', name: 'Dawson’s iPad', platform: 'ios', identifier: 'ios-e915', blocked: true },
  { id: 'd5', kidId: 'k3', name: 'Switch', platform: 'other', identifier: 'A4:C3:F0:12:9B:7E', blocked: true },
];

const SETTINGS: Settings = { resetTime: '00:00', autoApprove: false, routerStatus: 'none', routerModel: 'TP-Link Archer (model TBD)' };

export type Role = 'parent' | 'kid';

interface Store {
  role: Role; setRole: (r: Role) => void;
  currentKidId: string; setCurrentKidId: (id: string) => void;
  kids: Kid[]; chores: Chore[]; instances: ChoreInstance[]; devices: Device[]; settings: Settings;
  // derived
  kidLockState: (kidId: string) => LockState;
  requiredProgress: (kidId: string) => { done: number; total: number };
  pendingCount: number;
  // actions
  submit: (instanceId: string, photoUrl: string, note?: string) => void;
  approve: (instanceId: string) => void;
  reject: (instanceId: string, reason: string) => void;
  override: (kidId: string, mode: 'lock' | 'unlock' | null) => void;
  saveChore: (chore: Omit<Chore, 'id'> & { id?: string }) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  addDevice: (dev: Omit<Device, 'id' | 'blocked'>) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>('kid');
  const [currentKidId, setCurrentKidId] = useState('k3');
  const [kids, setKids] = useState(KIDS);
  const [chores, setChores] = useState(CHORES);
  const [instances, setInstances] = useState(INSTANCES);
  const [devices, setDevices] = useState(DEVICES);
  const [settings, setSettings] = useState(SETTINGS);

  const store = useMemo<Store>(() => {
    const requiredProgress = (kidId: string) => {
      const req = instances.filter((i) => i.kidId === kidId && chores.find((c) => c.id === i.choreId)?.required);
      return { done: req.filter((i) => i.status === 'approved').length, total: req.length };
    };
    const kidLockState = (kidId: string): LockState => {
      const kid = kids.find((k) => k.id === kidId);
      if (kid?.override === 'unlock') return 'unlocked';
      if (kid?.override === 'lock') return 'locked';
      const p = requiredProgress(kidId);
      return p.done === p.total ? 'unlocked' : 'locked';
    };
    const sync = (kidId: string, next: ChoreInstance[], nextKids = kids) => {
      // Recompute and push to the native shield (no-op on web).
      const kid = nextKids.find((k) => k.id === kidId)!;
      const req = next.filter((i) => i.kidId === kidId && chores.find((c) => c.id === i.choreId)?.required);
      const state: LockState = kid.override === 'unlock' ? 'unlocked' : kid.override === 'lock' ? 'locked' : req.every((i) => i.status === 'approved') ? 'unlocked' : 'locked';
      if (kidId === currentKidId) void applyLockState(state);
      setDevices((ds) => ds.map((dv) => (dv.kidId === kidId ? { ...dv, blocked: state === 'locked' } : dv)));
    };

    return {
      role, setRole, currentKidId, setCurrentKidId, kids, chores, instances, devices, settings,
      kidLockState, requiredProgress,
      pendingCount: instances.filter((i) => i.status === 'submitted').length,
      submit: (id, photoUrl, note) =>
        setInstances((cur) => {
          const next = cur.map((i) => (i.id === id ? { ...i, status: settings.autoApprove ? 'approved' : 'submitted', photoUrl, note, submittedAt: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) } as ChoreInstance : i));
          const kidId = cur.find((i) => i.id === id)!.kidId;
          if (settings.autoApprove) sync(kidId, next);
          return next;
        }),
      approve: (id) =>
        setInstances((cur) => {
          const next = cur.map((i) => (i.id === id ? { ...i, status: 'approved' as const, rejectionReason: undefined } : i));
          sync(cur.find((i) => i.id === id)!.kidId, next);
          return next;
        }),
      reject: (id, reason) =>
        setInstances((cur) => cur.map((i) => (i.id === id ? { ...i, status: 'rejected' as const, rejectionReason: reason, attempt: i.attempt + 1 } : i))),
      override: (kidId, mode) =>
        setKids((cur) => {
          const next = cur.map((k) => (k.id === kidId ? { ...k, override: mode } : k));
          sync(kidId, instances, next);
          return next;
        }),
      saveChore: (chore) =>
        setChores((cur) => (chore.id ? cur.map((c) => (c.id === chore.id ? { ...c, ...chore, id: c.id } : c)) : [...cur, { ...chore, id: `c${Date.now()}` }])),
      updateSettings: (patch) => setSettings((s) => ({ ...s, ...patch })),
      addDevice: (dev) => setDevices((cur) => [...cur, { ...dev, id: `d${Date.now()}`, blocked: kidLockState(dev.kidId) === 'locked' }]),
    };
  }, [role, currentKidId, kids, chores, instances, devices, settings]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
