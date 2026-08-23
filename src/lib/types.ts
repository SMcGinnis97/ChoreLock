export type ChoreStatus = 'todo' | 'submitted' | 'approved' | 'rejected';
export type LockState = 'locked' | 'unlocked' | 'unknown';
export type Recurrence = 'daily' | 'weekdays' | 'custom';

export interface Kid {
  id: string;
  name: string;
  age: number;
  avatarColor: string;
  lockState: LockState;
  streakDays: number;
  override: 'lock' | 'unlock' | null; // parent manual override for today
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
  required: boolean; // required for unlock; false = bonus
  photoProof: boolean;
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
  note?: string;
  submittedAt?: string;
  rejectionReason?: string;
}

export interface Device {
  id: string;
  kidId: string;
  name: string;
  platform: 'ios' | 'other';
  identifier: string; // iOS: install id; router-managed: MAC
  lastSeen?: string;
  blocked: boolean;
}

export interface Settings {
  resetTime: string; // "00:00"
  autoApprove: boolean;
  routerStatus: 'connected' | 'disconnected' | 'none';
  routerModel?: string;
}
