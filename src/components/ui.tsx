import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { ChoreStatus, Kid, LockState } from '../lib/types';

/* ---------- Icons (24px grid, stroke 2.2, round caps) ---------- */
const I = ({ children, size = 24 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
export const Icon = {
  Wifi: (p: { size?: number }) => <I {...p}><path d="M2 8.5a16 16 0 0 1 20 0" /><path d="M5.5 12a11 11 0 0 1 13 0" /><path d="M9 15.5a6 6 0 0 1 6 0" /><circle cx="12" cy="19" r="1" fill="currentColor" /></I>,
  WifiLock: (p: { size?: number }) => <I {...p}><path d="M2 8.5a16 16 0 0 1 20 0" /><path d="M5.5 12a11 11 0 0 1 9 -1.5" /><rect x="14" y="14" width="8" height="7" rx="1.5" /><path d="M16 14v-2a2 2 0 0 1 4 0v2" /><path d="M9 15.5a6 6 0 0 1 3 -0.8" /></I>,
  WifiOff: (p: { size?: number }) => <I {...p}><path d="M2 8.5a16 16 0 0 1 20 0" /><path d="M5.5 12a11 11 0 0 1 13 0" /><path d="M9 15.5a6 6 0 0 1 6 0" /><path d="M3 3l18 18" /></I>,
  Camera: (p: { size?: number }) => <I {...p}><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.5" /></I>,
  Check: (p: { size?: number }) => <I {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></I>,
  X: (p: { size?: number }) => <I {...p}><path d="M6 6l12 12M18 6L6 18" /></I>,
  Chevron: (p: { size?: number }) => <I {...p}><path d="M9 6l6 6-6 6" /></I>,
  Back: (p: { size?: number }) => <I {...p}><path d="M15 6l-6 6 6 6" /></I>,
  Warning: (p: { size?: number }) => <I {...p}><path d="M12 3l10 18H2z" /><path d="M12 10v5" /><circle cx="12" cy="18" r="1" fill="currentColor" /></I>,
  Home: (p: { size?: number }) => <I {...p}><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></I>,
  Checklist: (p: { size?: number }) => <I {...p}><path d="M4 6l2 2 3-3" /><path d="M4 13l2 2 3-3" /><path d="M4 20l2 2 3-3" /><path d="M12 7h8M12 14h8M12 21h8" /></I>,
  List: (p: { size?: number }) => <I {...p}><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="4" cy="6" r="1" fill="currentColor" /><circle cx="4" cy="12" r="1" fill="currentColor" /><circle cx="4" cy="18" r="1" fill="currentColor" /></I>,
  Gear: (p: { size?: number }) => <I {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></I>,
  Router: (p: { size?: number }) => <I {...p}><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 13V9M17 13V6" /><circle cx="7" cy="16.5" r="1" fill="currentColor" /><circle cx="11" cy="16.5" r="1" fill="currentColor" /></I>,
  Clock: (p: { size?: number }) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></I>,
  Flip: (p: { size?: number }) => <I {...p}><path d="M4 8a8 8 0 0 1 14-3l2 2" /><path d="M20 3v4h-4" /><path d="M20 16a8 8 0 0 1-14 3l-2-2" /><path d="M4 21v-4h4" /></I>,
  Phone: (p: { size?: number }) => <I {...p}><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></I>,
};

/* ---------- Primitives ---------- */
export const Avatar = ({ kid, size }: { kid: Kid; size?: 'sm' | 'lg' }) => (
  <div className={`avatar ${size ? `avatar--${size}` : ''}`} style={{ background: kid.avatarColor }}>{kid.name[0]}</div>
);

export const StatusChip = ({ status, bonus }: { status: ChoreStatus; bonus?: boolean }) => {
  const label = { todo: 'To do', submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected' }[status];
  if (bonus && status === 'todo') return <span className="chip chip--bonus">Bonus</span>;
  return <span className={`chip chip--${status}`}>{label}</span>;
};

export const LockBanner = ({ state, kidName, empty }: { state: LockState; kidName?: string; empty?: boolean }) => {
  if (state === 'unknown')
    return <div className="banner banner--neutral"><Icon.WifiOff /><div><h2>Can’t check status</h2><p>Your last status is still in effect</p></div></div>;
  if (state === 'unlocked')
    return <div className="banner banner--unlocked celebrate"><Icon.Wifi /><div><h2>Wi-Fi Unlocked ✅</h2><p>{empty ? 'No chores today — it’s all yours' : 'You’re all set until midnight. Enjoy!'}</p></div></div>;
  return <div className="banner banner--locked"><Icon.WifiLock /><div><h2>Wi-Fi Locked 🔒</h2><p>Unlocks when all {kidName ? 'your' : 'the'} chores are approved</p></div></div>;
};

export const Ring = ({ done, total }: { done: number; total: number }) => {
  const r = 28.5, c = 2 * Math.PI * r, pct = total ? done / total : 0;
  return (
    <svg width="66" height="66" viewBox="0 0 66 66">
      <circle cx="33" cy="33" r={r} stroke="var(--border)" strokeWidth="9" fill="none" />
      <circle cx="33" cy="33" r={r} stroke={pct >= 1 ? 'var(--ok)' : 'var(--accent)'} strokeWidth="9" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform="rotate(-90 33 33)" style={{ transition: 'stroke-dashoffset .4s' }} />
      <text x="33" y="38" textAnchor="middle" fontSize="16" fontWeight="800" fill="var(--ink)" fontFamily="var(--font-body)">{done}/{total}</text>
    </svg>
  );
};

export const Switch = ({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) => (
  <button type="button" role="switch" aria-checked={on} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />
);

export const todayLabel = () => new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

/* ---------- Parent navigation ---------- */
export const ParentTabs = ({ pending }: { pending: number }) => {
  const tabs = [
    { to: '/parent', label: 'Today', icon: <Icon.Home />, end: true },
    { to: '/parent/approvals', label: 'Approvals', icon: <Icon.Checklist />, badge: pending },
    { to: '/parent/chores', label: 'Chores', icon: <Icon.List /> },
    { to: '/parent/settings', label: 'Settings', icon: <Icon.Gear /> },
  ];
  return (
    <>
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
          {t.icon}<span>{t.label}</span>{t.badge ? <span className="badge">{t.badge}</span> : null}
        </NavLink>
      ))}
    </>
  );
};
