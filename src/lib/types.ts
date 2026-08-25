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
  joinCode?: string; // shown to parent for enrolling kid devices
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
}

/** Ad-hoc bonus task ("side quest") a parent drops in, worth points. */
export interface SideQuest {
  id: string;
  title: string;
  note?: string;
  points: number;
  promptUrl?: string; // parent's photo of the task
  kidId: string | null; // null = open for any kid to claim
  status: QuestStatus;
  proofUrl?: string;
  proofIsVideo?: boolean;
  proofNote?: string;
  rejectionReason?: string;
  submittedAt?: string;
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
}
