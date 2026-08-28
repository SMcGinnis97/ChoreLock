/**
 * App state. Ships with an in-memory mock matching the handoff's sample family so
 * every screen renders without a backend. Swap `api` for the Supabase client in
 * src/lib/supabase.ts once the project is created — the shape is identical.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Chore, ChoreGroup, ChoreInstance, CriticalInstance, CriticalTask, Device, FamilyParent, Kid, ListItem, LockState, MoneyEntry, NightEvent, ProofBundle, ProofMedia, Reward, RewardClaim, Settings, SideQuest, Summon, UnlockRequest } from './types';
import { applyLockState, type ShieldContent } from '../native/screenTime';

export const today = () => new Date().toISOString().slice(0, 10);

/** The summon currently dinging for a kid, if any. */
export const activeSummon = (list: Summon[], kidId: string) =>
  list.find((x) => x.kidId === kidId && !x.acknowledgedAt && !x.canceledAt && new Date(x.expiresAt).getTime() > Date.now());

/** True when the kid is currently grounded (locked no matter what). */
export const isGrounded = (k: Kid | undefined) => !!k?.groundedUntil && new Date(k.groundedUntil).getTime() > Date.now();

/** Minutes an instance is overdue (negative = not due yet). */
export const criticalLateMin = (ci: CriticalInstance) => (Date.now() - new Date(ci.dueAt).getTime()) / 60_000;

/**
 * True when an open critical round locks this kid right now: the assignee past
 * lockAfterMin, or anyone in the family past lockAllAfterMin. Mirrors the
 * kid_lock_state view; callers handle the absence exemption (checked earlier).
 */
export const criticalLocked = (tasks: CriticalTask[], instances: CriticalInstance[], kidId: string) =>
  instances.some((ci) => {
    if (ci.status !== 'open') return false;
    const t = tasks.find((x) => x.id === ci.taskId);
    if (!t) return false;
    const late = criticalLateMin(ci);
    return ci.kidId === kidId ? late >= t.lockAfterMin : late >= t.lockAllAfterMin;
  });

/** The critical rounds a kid should see on their home screen: theirs, or any once broadcast. */
export const criticalsForKid = (instances: CriticalInstance[], kidId: string) =>
  instances.filter((ci) => ci.status === 'open' && (ci.kidId === kidId || ci.level >= 2));

/** True while a granted 15-minute pass is running. */
export const hasPass = (k: Kid | undefined) => !!k?.unlockUntil && new Date(k.unlockUntil).getTime() > Date.now();

/** Allowance balance in cents. */
export const balanceCents = (ledger: MoneyEntry[], kidId: string) =>
  ledger.filter((e) => e.kidId === kidId).reduce((n, e) => n + e.cents, 0);

/** "$12.50" (negative-safe). */
export const fmtMoney = (cents: number) => `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;

const cap34 = (s: string) => (s.length > 34 ? `${s.slice(0, 33)}…` : s);

/**
 * Builds the shield screen's content per the design handoff: which of the four
 * states applies, with placeholders substituted here (the extension only renders).
 */
export function buildShieldContent(
  kid: Kid, chores: Chore[], instances: ChoreInstance[],
  criticalTasks: CriticalTask[], criticalInstances: CriticalInstance[], unlockRequests: UnlockRequest[],
): ShieldContent {
  if (isGrounded(kid)) {
    const d = new Date(kid.groundedUntil!);
    const until = (kid.groundedUntil ?? '') >= '9999' ? 'a parent lifts it'
      : d.toLocaleString([], { weekday: 'short', hour: 'numeric', ...(d.getMinutes() > 0 && { minute: '2-digit' }) }).replace(',', '');
    return {
      state: 'grounded',
      title: `Grounded until ${until}`,
      subtitle: kid.groundedReason ? `Reason: ${cap34(kid.groundedReason)}. Only a parent can lift this early.` : 'Only a parent can lift this early.',
    };
  }
  const crit = criticalInstances
    .filter((ci) => ci.status === 'open')
    .map((ci) => ({ ci, t: criticalTasks.find((x) => x.id === ci.taskId), late: criticalLateMin(ci) }))
    .filter((x) => x.t && ((x.ci.kidId === kid.id && x.late >= x.t.lockAfterMin) || x.late >= x.t.lockAllAfterMin))
    .sort((a, b) => b.late - a.late)[0];
  if (crit) {
    return {
      state: 'critical',
      title: `${crit.t!.emoji} ${crit.ci.title}`,
      subtitle: `${Math.max(1, Math.floor(crit.late))} minutes late. Nothing unlocks until this one’s done.`,
    };
  }
  const remaining = instances.filter((i) => i.kidId === kid.id && i.status !== 'approved' && chores.find((c) => c.id === i.choreId)?.required);
  const nextInst = remaining.find((i) => i.status === 'todo' || i.status === 'rejected') ?? remaining[0];
  const next = cap34(chores.find((c) => c.id === nextInst?.choreId)?.name ?? 'your chores');
  const deniedRecently = unlockRequests.some((r) =>
    r.kidId === kid.id && r.kind === 'fifteen' && r.status === 'denied'
    && !!r.resolvedAt && Date.now() - new Date(r.resolvedAt).getTime() < 3600_000);
  return {
    state: 'chores',
    title: `${remaining.length || 1} to go, ${kid.name} 🔑`,
    subtitle: kid.streakDays >= 2 ? `Next up: ${next}. Your ${kid.streakDays}-day streak is still alive 🔥` : `Next up: ${next}.`,
    allowRequest: !deniedRecently,
  };
}

/** True when a chore's due time has passed today. False when it has no due time. */
export const pastDue = (c: Chore | undefined) => {
  if (!c?.dueTime) return false;
  const [h, m] = c.dueTime.split(':').map(Number);
  const due = new Date(); due.setHours(h, m, 0, 0);
  return new Date() >= due;
};

/** An 'expire' chore that blew past its due time unapproved — dead for today, breaks the streak. */
export const isMissed = (i: ChoreInstance, c: Chore | undefined) =>
  !!c && c.overdue === 'expire' && i.status !== 'approved' && pastDue(c);

/** True when a required instance blocks Wi-Fi right now (due-time and overdue-mode aware). */
export const blocksNow = (i: ChoreInstance, c: Chore | undefined) => {
  if (!c?.required || i.status === 'approved') return false;
  if (c.dueTime) {
    if (!pastDue(c)) return false;
    if (c.overdue === 'expire') return false; // missed, not blocking — the streak takes the hit
  }
  return true;
};

/** Whose turn a chore group is this week — away kids skipped, same rule as the server. */
export const groupTurnKid = (g: ChoreGroup, kids: Kid[]): string | undefined => {
  const n = g.kidIds.length;
  if (!n) return undefined;
  for (let i = 0; i < n; i++) {
    const id = g.kidIds[(g.rotationIndex + i) % n];
    const k = kids.find((x) => x.id === id);
    if (!(k?.absentUntil && k.absentUntil >= today())) return id;
  }
  return g.kidIds[g.rotationIndex % n];
};

const KIDS: Kid[] = [
  { id: 'k1', name: 'Tenleigh', age: 15, avatarColor: '#0D9488', lockState: 'unlocked', streakDays: 12, points: 25, override: null },
  { id: 'k2', name: 'Taegyn', age: 13, avatarColor: '#B45309', lockState: 'locked', streakDays: 3, points: 10, override: null },
  { id: 'k3', name: 'Dawson', age: 9, avatarColor: '#5B5BD6', lockState: 'locked', streakDays: 5, points: 40, override: null },
];

const CHORES: Chore[] = [
  { id: 'c1', name: 'Feed the dog', emoji: '🐶', instruction: 'Show the full bowl', kidIds: ['k3'], recurrence: 'daily', days: [], rotation: 'none', overdue: 'block', proofType: 'photo', required: true, photoProof: true },
  { id: 'c2', name: 'Unload dishwasher', emoji: '🍽️', instruction: 'Show the empty dishwasher', kidIds: ['k3', 'k2'], recurrence: 'daily', days: [], rotation: 'daily', overdue: 'block', proofType: 'photo', required: true, photoProof: true },
  { id: 'c3', name: 'Make your bed', emoji: '🛏️', instruction: 'Show the whole bed', kidIds: ['k1', 'k2', 'k3'], recurrence: 'daily', days: [], rotation: 'none', overdue: 'block', proofType: 'photo', required: true, photoProof: true },
  { id: 'c4', name: 'Take out trash', emoji: '🗑️', kidIds: ['k3'], recurrence: 'weekdays', days: [], rotation: 'none', overdue: 'block', proofType: 'photo', required: true, photoProof: true, dueTime: '17:00' },
  { id: 'c5', name: 'Water the plants', emoji: '🪴', kidIds: ['k3'], recurrence: 'daily', days: [], rotation: 'none', overdue: 'block', proofType: 'photo', required: false, photoProof: true },
  { id: 'c6', name: 'Vacuum living room', emoji: '🧹', kidIds: ['k1'], recurrence: 'custom', days: [1, 4], rotation: 'none', overdue: 'block', proofType: 'photo', required: true, photoProof: true },
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
  { id: 'q1', title: 'Wipe down the patio table', note: 'Before grandma visits Saturday', points: 10, kidId: null, status: 'open', promptUrls: [] },
  { id: 'q2', title: 'Pull weeds by the mailbox', points: 15, kidId: 'k3', status: 'claimed', promptUrls: [] },
];

const REWARDS: Reward[] = [
  { id: 'r1', title: 'Ice cream run', emoji: '🍦', points: 30 },
  { id: 'r2', title: '1 hr extra screen time', emoji: '🎮', points: 50 },
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
  cents?: number; // set = pays money on approval instead of points
  kidId: string | null;
  promptMedia: ProofMedia[]; // parent's photos of the task (appended to any existing)
}

export interface CriticalDraft extends Omit<CriticalTask, 'id' | 'nextFireAt'> { id?: string }

export interface Store {
  role: Role; setRole: (r: Role) => void;
  currentKidId: string; setCurrentKidId: (id: string) => void;
  kids: Kid[]; chores: Chore[]; groups: ChoreGroup[]; instances: ChoreInstance[]; quests: SideQuest[]; devices: Device[]; settings: Settings;
  summons: Summon[];
  criticalTasks: CriticalTask[]; criticalInstances: CriticalInstance[];
  unlockRequests: UnlockRequest[];
  listItems: ListItem[]; moneyLedger: MoneyEntry[]; nightEvents: NightEvent[];
  parents: FamilyParent[];
  rewards: Reward[]; rewardClaims: RewardClaim[];
  // derived
  kidLockState: (kidId: string) => LockState;
  requiredProgress: (kidId: string) => { done: number; total: number };
  pendingCount: number;
  // actions
  submit: (instanceId: string, proof: ProofBundle, note?: string) => void;
  approve: (instanceId: string) => void;
  /** keepStreak = streak mercy: the day still counts even if the redo never lands. */
  reject: (instanceId: string, reason: string, keepStreak?: boolean) => void;
  /** Parent escape hatch: put an instance back to 'todo' (undo a manual approve). */
  reopen: (instanceId: string) => void;
  override: (kidId: string, mode: 'lock' | 'unlock' | null) => void;
  setAbsent: (kidId: string, until: string | null) => void;
  /** Ground (until ISO timestamp + reason) or lift (null). Grounding trumps everything. */
  setGrounding: (kidId: string, until: string | null, reason?: string) => void;
  /** Call kids to a location — repeated pushes until each one acknowledges. */
  callKids: (kidIds: string[], location: string, note?: string, meeting?: boolean) => void;
  ackSummon: (id: string) => void;
  cancelSummon: (id: string) => void;
  saveCriticalTask: (task: CriticalDraft) => void;
  deleteCriticalTask: (id: string) => void;
  /** Mark an open critical round done (kid: theirs or any broadcast one; parent: any). */
  completeCritical: (instanceId: string) => void;
  /** Parent-only: dismiss a round without doing it (locks lift, next round still books). */
  cancelCritical: (instanceId: string) => void;
  /** Parent answers a shield "Ask for 15 minutes": grant starts the pass, deny quiets the button an hour. */
  resolveUnlockRequest: (id: string, grant: boolean) => void;
  addListItem: (text: string) => void;
  setListItemDone: (id: string, done: boolean) => void;
  removeListItem: (id: string) => void;
  /** Parent ledger entry: negative cents = payout, any sign for 'adjust'. */
  recordMoney: (kidId: string, cents: number, kind: 'payout' | 'adjust', note?: string) => void;
  saveChore: (chore: Omit<Chore, 'id'> & { id?: string }, refMedia?: ProofMedia[]) => void;
  /** Create/update a chore group ("chore list") — ordered kid rotation, advances weekly. choreIds = the full member list. */
  saveGroup: (group: Omit<ChoreGroup, 'id' | 'rotationIndex'> & { id?: string }, choreIds: string[]) => void;
  deleteGroup: (groupId: string) => void;
  /** Hand the group to the next kid right now (manual swap). */
  advanceGroup: (groupId: string) => void;
  /** Move a kid's unfinished chores for today onto a sibling (away hand-off). */
  handoffToday: (fromKidId: string, toKidId: string) => void;
  saveQuest: (quest: QuestDraft) => void;
  claimQuest: (questId: string) => void;
  submitQuest: (questId: string, media: ProofMedia, note?: string) => void;
  reviewQuest: (questId: string, approved: boolean, reason?: string) => void;
  saveReward: (reward: Omit<Reward, 'id'> & { id?: string }) => void;
  deleteReward: (rewardId: string) => void;
  redeemReward: (rewardId: string) => void; // kid asks to spend points
  resolveClaim: (claimId: string, grant: boolean) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  addDevice: (dev: Omit<Device, 'id' | 'blocked'>) => void;
  updateDevice: (id: string, patch: Pick<Device, 'override' | 'scheduleStart' | 'scheduleEnd'>) => void;
  removeDevice?: (id: string) => Promise<void>;
  addKid?: (kid: { name: string; age: number; avatarColor: string }) => Promise<void>;
  removeKid?: (kidId: string) => Promise<void>;
  signOut?: () => Promise<void>;
  /** Re-fetch everything (pull-to-refresh). No-op in mock mode. */
  reload?: () => Promise<void>;
  loading?: boolean;
  error?: string | null;
}

export const Ctx = createContext<Store | null>(null);

export function MockStoreProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>('kid');
  const [currentKidId, setCurrentKidId] = useState('k3');
  const [kids, setKids] = useState(KIDS);
  const [chores, setChores] = useState(CHORES);
  const [groups, setGroups] = useState<ChoreGroup[]>([]);
  const [instances, setInstances] = useState(INSTANCES);
  const [quests, setQuests] = useState(QUESTS);
  const [rewards, setRewards] = useState(REWARDS);
  const [rewardClaims, setRewardClaims] = useState<RewardClaim[]>([]);
  const [devices, setDevices] = useState(DEVICES);
  const [settings, setSettings] = useState(SETTINGS);
  const [summons, setSummons] = useState<Summon[]>([]);
  const [criticalTasks, setCriticalTasks] = useState<CriticalTask[]>([]);
  const [criticalInstances, setCriticalInstances] = useState<CriticalInstance[]>([]);
  const [unlockRequests, setUnlockRequests] = useState<UnlockRequest[]>([]);
  const [listItems, setListItems] = useState<ListItem[]>([]);
  const [moneyLedger, setMoneyLedger] = useState<MoneyEntry[]>([]);

  const store = useMemo<Store>(() => {
    const requiredProgress = (kidId: string) => {
      const req = instances.filter((i) => i.kidId === kidId && chores.find((c) => c.id === i.choreId)?.required);
      return { done: req.filter((i) => i.status === 'approved').length, total: req.length };
    };
    const kidLockState = (kidId: string): LockState => {
      const kid = kids.find((k) => k.id === kidId);
      if (isGrounded(kid)) return 'locked';
      if (kid?.absentUntil && kid.absentUntil >= today()) return 'unlocked';
      if (criticalLocked(criticalTasks, criticalInstances, kidId)) return 'locked';
      if (hasPass(kid)) return 'unlocked';
      if (kid?.override === 'unlock') return 'unlocked';
      if (kid?.override === 'lock') return 'locked';
      return instances.some((i) => i.kidId === kidId && blocksNow(i, chores.find((c) => c.id === i.choreId))) ? 'locked' : 'unlocked';
    };
    const sync = (kidId: string, next: ChoreInstance[], nextKids = kids) => {
      // Recompute and push to the native shield (no-op on web).
      const kid = nextKids.find((k) => k.id === kidId)!;
      const blocked = next.some((i) => i.kidId === kidId && blocksNow(i, chores.find((c) => c.id === i.choreId)));
      const state: LockState = isGrounded(kid) ? 'locked' : kid.override === 'unlock' ? 'unlocked' : kid.override === 'lock' ? 'locked' : blocked ? 'locked' : 'unlocked';
      if (kidId === currentKidId) void applyLockState(state);
      setDevices((ds) => ds.map((dv) => (dv.kidId === kidId ? { ...dv, blocked: state === 'locked' } : dv)));
    };

    return {
      role, setRole, currentKidId, setCurrentKidId, kids, chores, groups, instances, quests, devices, settings, summons,
      criticalTasks, criticalInstances, unlockRequests,
      listItems, moneyLedger, nightEvents: [],
      parents: [{ userId: 'p1', name: 'Sage', email: 'parent@example.com', isMe: true }],
      rewards, rewardClaims,
      kidLockState, requiredProgress,
      pendingCount: instances.filter((i) => i.status === 'submitted').length + quests.filter((q) => q.status === 'submitted').length + rewardClaims.filter((c) => c.status === 'requested').length,
      submit: (id, proof, note) =>
        setInstances((cur) => {
          const auto = settings.autoApprove && cur.find((i) => i.id === id)!.attempt === 1;
          const urls = proof.photos.map((p) => p.previewUrl);
          const next = cur.map((i) => (i.id === id ? { ...i, status: auto ? 'approved' : 'submitted', photoUrl: urls[0], photoUrls: urls, videoUrl: proof.video?.previewUrl, note, submittedAt: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) } as ChoreInstance : i));
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
      reject: (id, reason, keepStreak) =>
        setInstances((cur) => {
          const next = cur.map((i) => (i.id === id ? { ...i, status: 'rejected' as const, rejectionReason: reason, attempt: i.attempt + 1, streakExempt: !!keepStreak } : i));
          sync(cur.find((i) => i.id === id)!.kidId, next);
          return next;
        }),
      reopen: (id) =>
        setInstances((cur) => {
          const next = cur.map((i) => (i.id === id ? { ...i, status: 'todo' as const, rejectionReason: undefined } : i));
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
      callKids: (kidIds, location, note, meeting) =>
        setSummons((cur) => [
          ...cur.map((x) => (kidIds.includes(x.kidId) && !x.acknowledgedAt && !x.canceledAt ? { ...x, canceledAt: new Date().toISOString() } : x)),
          ...kidIds.map((kidId, n) => ({
            id: `sm${Date.now()}-${n}`, kidId, location, note: note || undefined, meeting: !!meeting,
            createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          })),
        ]),
      ackSummon: (id) => setSummons((cur) => cur.map((x) => (x.id === id ? { ...x, acknowledgedAt: new Date().toISOString() } : x))),
      cancelSummon: (id) => setSummons((cur) => cur.map((x) => (x.id === id ? { ...x, canceledAt: new Date().toISOString() } : x))),
      // Mock criticals: save/complete/cancel locally; the mock fires a round immediately on
      // save so the screens are exercisable without the real cron engine.
      saveCriticalTask: (t) =>
        setCriticalTasks((cur) => {
          if (t.id) return cur.map((x) => (x.id === t.id ? { ...x, ...t, id: x.id } : x));
          const id = `ct${Date.now()}`;
          setCriticalInstances((ci) => [...ci, { id: `cti${Date.now()}`, taskId: id, kidId: t.kidId, kind: 'main', title: t.title, dueAt: new Date().toISOString(), status: 'open', level: 0 }]);
          return [...cur, { ...t, id }];
        }),
      deleteCriticalTask: (id) => {
        setCriticalTasks((cur) => cur.filter((t) => t.id !== id));
        setCriticalInstances((cur) => cur.filter((ci) => ci.taskId !== id));
      },
      completeCritical: (id) =>
        setCriticalInstances((cur) => cur.map((ci) => (ci.id === id ? { ...ci, status: 'done', doneAt: new Date().toISOString(), doneBy: role === 'kid' ? currentKidId : undefined } : ci))),
      cancelCritical: (id) => setCriticalInstances((cur) => cur.map((ci) => (ci.id === id ? { ...ci, status: 'canceled' } : ci))),
      addListItem: (text) => setListItems((cur) => [{ id: `li${Date.now()}`, text, addedByKid: role === 'kid' ? currentKidId : undefined, createdAt: new Date().toISOString() }, ...cur]),
      setListItemDone: (id, done) => setListItems((cur) => cur.map((x) => (x.id === id ? { ...x, doneAt: done ? new Date().toISOString() : undefined } : x))),
      removeListItem: (id) => setListItems((cur) => cur.filter((x) => x.id !== id)),
      recordMoney: (kidId, cents, kind, note) => setMoneyLedger((cur) => [{ id: `m${Date.now()}`, kidId, cents, kind, note, createdAt: new Date().toISOString() }, ...cur]),
      resolveUnlockRequest: (id, grant) => {
        setUnlockRequests((cur) => cur.map((r) => (r.id === id ? { ...r, status: grant ? 'granted' : 'denied', resolvedAt: new Date().toISOString() } : r)));
        if (grant) {
          const req = unlockRequests.find((r) => r.id === id);
          if (req) setKids((cur) => cur.map((k) => (k.id === req.kidId ? { ...k, unlockUntil: new Date(Date.now() + 15 * 60_000).toISOString() } : k)));
        }
      },
      setGrounding: (kidId, until, reason) =>
        setKids((cur) => {
          const next = cur.map((k) => (k.id === kidId ? { ...k, groundedUntil: until ?? undefined, groundedReason: until ? reason : undefined } : k));
          sync(kidId, instances, next);
          return next;
        }),
      saveChore: (chore, refMedia) => {
        const refUrls = [...(chore.refUrls ?? []), ...(refMedia ?? []).map((m) => m.previewUrl)].slice(0, 5);
        setChores((cur) => (chore.id ? cur.map((c) => (c.id === chore.id ? { ...c, ...chore, refUrls, id: c.id } : c)) : [...cur, { ...chore, refUrls, id: `c${Date.now()}` }]));
      },
      saveGroup: (g, choreIds) => {
        const id = g.id ?? `g${Date.now()}`;
        setGroups((cur) => (g.id ? cur.map((x) => (x.id === g.id ? { ...x, ...g, id: x.id } : x)) : [...cur, { ...g, id, rotationIndex: 0 }]));
        setChores((cur) => cur.map((c) => (
          choreIds.includes(c.id) ? { ...c, groupId: id } : c.groupId === id ? { ...c, groupId: undefined } : c
        )));
      },
      deleteGroup: (id) => {
        setGroups((cur) => cur.filter((g) => g.id !== id));
        setChores((cur) => cur.map((c) => (c.groupId === id ? { ...c, groupId: undefined } : c)));
      },
      advanceGroup: (id) => setGroups((cur) => cur.map((g) => (g.id === id ? { ...g, rotationIndex: g.rotationIndex + 1 } : g))),
      handoffToday: (from, to) =>
        setInstances((cur) => cur.map((i) => (
          i.kidId === from && i.status !== 'approved' && !cur.some((x) => x.choreId === i.choreId && x.kidId === to)
            ? { ...i, kidId: to } : i
        ))),
      saveQuest: (q) =>
        setQuests((cur) => (q.id
          ? cur.map((x) => (x.id === q.id ? { ...x, title: q.title, note: q.note, points: q.points, kidId: q.kidId, promptUrls: [...x.promptUrls, ...q.promptMedia.map((m) => m.previewUrl)] } : x))
          : [...cur, { id: `q${Date.now()}`, title: q.title, note: q.note, points: q.points, kidId: q.kidId, promptUrls: q.promptMedia.map((m) => m.previewUrl), status: q.kidId ? 'claimed' : 'open' }])),
      claimQuest: (id) => setQuests((cur) => cur.map((q) => (q.id === id ? { ...q, kidId: currentKidId, status: 'claimed' } : q))),
      submitQuest: (id, media, note) =>
        setQuests((cur) => cur.map((q) => (q.id === id ? { ...q, status: 'submitted', proofUrl: media.previewUrl, proofIsVideo: media.isVideo, proofNote: note, submittedAt: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) } : q))),
      reviewQuest: (id, ok, reason) =>
        setQuests((cur) => cur.map((q) => (q.id === id ? { ...q, status: ok ? 'approved' : 'rejected', rejectionReason: ok ? undefined : reason } : q))),
      saveReward: (r) => setRewards((cur) => (r.id ? cur.map((x) => (x.id === r.id ? { ...x, ...r, id: x.id } : x)) : [...cur, { ...r, id: `r${Date.now()}` }])),
      deleteReward: (id) => setRewards((cur) => cur.filter((r) => r.id !== id)),
      redeemReward: (rewardId) => setRewardClaims((cur) => [...cur, { id: `rc${Date.now()}`, rewardId, kidId: currentKidId, status: 'requested' }]),
      resolveClaim: (id, grant) => setRewardClaims((cur) => cur.map((c) => (c.id === id ? { ...c, status: grant ? 'granted' : 'denied' } : c))),
      updateSettings: (patch) => setSettings((s) => ({ ...s, ...patch })),
      reload: () => new Promise((res) => setTimeout(res, 600)),
      addDevice: (dev) => setDevices((cur) => [...cur, { ...dev, id: `d${Date.now()}`, blocked: dev.kidId ? kidLockState(dev.kidId) === 'locked' : !kids.every((k) => kidLockState(k.id) === 'unlocked') }]),
      updateDevice: (id, patch) => setDevices((cur) => cur.map((dv) => (dv.id === id ? { ...dv, ...patch } : dv))),
    };
  }, [role, currentKidId, kids, chores, groups, instances, quests, rewards, rewardClaims, devices, settings, summons, criticalTasks, criticalInstances, unlockRequests, listItems, moneyLedger]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
