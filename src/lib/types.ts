export type ChoreStatus = 'todo' | 'submitted' | 'approved' | 'rejected';
export type LockState = 'locked' | 'unlocked' | 'unknown';
export type Recurrence = 'daily' | 'weekdays' | 'custom';
export type Rotation = 'none' | 'daily' | 'weekly' | 'every_other_day' | 'after_done';
export type QuestStatus = 'open' | 'claimed' | 'submitted' | 'approved' | 'rejected';
export type ProofType = 'photo' | 'video' | 'photo_video';

export interface Kid {
  id: string;
  name: string;
  age: number;
  avatarColor: string;
  lockState: LockState;
  streakDays: number;
  points: number; // side-quest points earned
  override: 'lock' | 'unlock' | null; // parent manual override for today
  absentUntil?: string; // YYYY-MM-DD; set = away (no chores, unlocked) through that date
  groundedUntil?: string; // ISO timestamp; set + future = grounded (locked no matter what)
  groundedReason?: string; // shown to the kid (banner + push)
  unlockUntil?: string; // ISO; a granted 15-minute pass — unlocked until then (never beats grounding/criticals)
  joinCode?: string; // shown to parent for enrolling kid devices
}

/** A shield-button ask: "Ask for 15 minutes" (pending → granted/denied) or an "I'm on it" ping. */
export interface UnlockRequest {
  id: string;
  kidId: string;
  kind: 'fifteen' | 'inprogress';
  status: 'pending' | 'granted' | 'denied';
  createdAt: string;
  resolvedAt?: string;
}

/** A chore definition (what repeats). */
export interface Chore {
  id: string;
  name: string;
  emoji: string;
  instruction?: string;
  kidIds: string[];
  recurrence: Recurrence;
  days: number[]; // 0=Sun..6=Sat, used when recurrence === 'custom'
  rotation: Rotation; // how the chore moves between assigned kids
  dueTime?: string; // "HH:MM" — only blocks Wi-Fi after this time; unset = blocks all day
  required: boolean; // required for unlock; false = bonus
  photoProof: boolean; // proof needed at all
  proofType: ProofType; // what kind(s) of live proof
}

/** Today's instance of a chore for one kid. */
export interface ChoreInstance {
  id: string;
  choreId: string;
  kidId: string;
  date: string; // YYYY-MM-DD
  status: ChoreStatus;
  attempt: number;
  photoUrl?: string;
  videoUrl?: string; // short clip proof (chore may require photo, video, or both)
  note?: string;
  submittedAt?: string;
  rejectionReason?: string;
  reviewedBy?: string; // parent user id — powers the co-parent activity feed
  reviewedAt?: string; // ISO
}

/** Ad-hoc bonus task ("side quest") a parent drops in, worth points. */
export interface SideQuest {
  id: string;
  title: string;
  note?: string;
  points: number;
  cents?: number; // set = a money quest (pays $ on approval instead of points mattering)
  promptUrls: string[]; // parent's photos of the task
  kidId: string | null; // null = open for any kid to claim
  status: QuestStatus;
  proofUrl?: string;
  proofIsVideo?: boolean;
  proofNote?: string;
  rejectionReason?: string;
  submittedAt?: string;
  reviewedBy?: string; // parent user id
  reviewedAt?: string; // ISO
}

/** A parent-defined reward kids can spend quest points on. */
export interface Reward {
  id: string;
  title: string;
  emoji: string;
  points: number;
}

export interface RewardClaim {
  id: string;
  rewardId: string;
  kidId: string;
  status: 'requested' | 'granted' | 'denied';
  resolvedBy?: string; // parent user id
  resolvedAt?: string; // ISO
}

/** What a chore submission carries — one or both, per the chore's proofType. */
export interface ProofBundle {
  photo?: ProofMedia;
  video?: ProofMedia;
}

/** Captured proof ready to upload (live photo or ≤10s video). */
export interface ProofMedia {
  blob: Blob;
  ext: 'jpg' | 'mp4' | 'webm';
  contentType: string;
  previewUrl: string; // object/data URL for optimistic UI
  isVideo: boolean;
}

/** A "come here now" call from a parent. Dings the kid every 30s until acknowledged. */
export interface Summon {
  id: string;
  kidId: string;
  location: string;
  note?: string;
  meeting: boolean; // part of a family-meeting call (everyone)
  createdAt: string; // ISO
  expiresAt: string; // ISO — pings stop on their own after this
  acknowledgedAt?: string;
  canceledAt?: string;
}

/**
 * A recurring must-do job ("Take the dogs out" every 2 hours) with an escalation ladder:
 * fire → +lockAfterMin locks the assigned kid → +broadcastAfterMin goes out to every kid →
 * +lockAllAfterMin locks every present kid. Optional follow-up fires after completion.
 */
export interface CriticalTask {
  id: string;
  kidId: string; // primary assignee
  title: string;
  emoji: string;
  note?: string;
  firstFire: string; // "HH:MM" family-local daily anchor
  repeatMinutes?: number; // unset = once a day
  windowEnd?: string; // "HH:MM" — no fires after this time
  lockAfterMin: number;
  broadcastAfterMin: number;
  lockAllAfterMin: number;
  followupTitle?: string; // e.g. "Bring the dogs back in"
  followupDelayMin: number;
  active: boolean;
  nextFireAt?: string; // ISO; unset while a round is in flight
}

/** One fired round of a critical task (or its follow-up). */
export interface CriticalInstance {
  id: string;
  taskId: string;
  kidId: string;
  kind: 'main' | 'followup';
  title: string;
  dueAt: string; // ISO fire moment — the escalation clock
  status: 'scheduled' | 'open' | 'done' | 'canceled';
  level: number; // 0 fired · 1 kid locked · 2 broadcast · 3 everyone locked
  doneAt?: string;
  doneBy?: string; // kid id; unset = a parent marked it done
}

export interface FamilyParent {
  userId: string;
  name?: string;
  email?: string;
  isMe: boolean;
}

export interface Device {
  id: string;
  kidId: string | null; // null = community device (shared PS5/TV) — needs ALL kids clear
  name: string;
  platform: 'ios' | 'other';
  identifier: string; // iOS: install id; router-managed: MAC
  lastSeen?: string;
  blocked: boolean;
  override?: 'lock' | 'unlock' | null; // router devices: force off/on regardless of chores
  scheduleStart?: string; // "HH:MM" daily allowed window (router devices)
  scheduleEnd?: string;
}

export interface Settings {
  resetTime: string; // "00:00"
  autoApprove: boolean;
  routerStatus: 'connected' | 'disconnected' | 'none';
  routerModel?: string;
  parentCode?: string; // invite code for adding a co-parent (parent role only)
  streakRewardDays?: number; // every N consecutive completed days…
  streakRewardCents?: number; // …pays this much (unset = allowance off)
  nightStart?: string; // "HH:MM" night-watch window (unset = off)
  nightEnd?: string;
  nightThresholdMin?: number; // minutes of watched-app use inside the window that trips a flag
}

/** A shared "we need" item — anyone adds ("we need milk"), anyone checks off. */
export interface ListItem {
  id: string;
  text: string;
  addedByKid?: string; // kid id; unset = a parent added it
  doneAt?: string;
  createdAt: string;
}

/** One allowance ledger line. Balance = sum of cents. */
export interface MoneyEntry {
  id: string;
  kidId: string;
  cents: number; // positive = earned, negative = paid out
  kind: 'streak' | 'quest' | 'payout' | 'adjust';
  note?: string;
  createdAt: string;
}

/** Anonymous night-watch flag from a kid device (no app identities involved). */
export interface NightEvent {
  id: string;
  kidId: string;
  kind: 'night' | 'wake'; // night = watched apps used ≥ threshold inside the window; wake = first screen use after it
  at: string;
}
