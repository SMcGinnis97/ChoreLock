import { useState } from 'react';
import { criticalLateMin, useStore, type CriticalDraft } from '../../lib/store';
import { Avatar, Switch } from '../../components/ui';
import type { Chore, Recurrence, Rotation } from '../../lib/types';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const ROTATIONS: { value: Rotation; label: string; sub: string }[] = [
  { value: 'none', label: 'Everyone', sub: 'Each selected kid gets it' },
  { value: 'daily', label: 'Daily', sub: 'Next kid each day' },
  { value: 'every_other_day', label: 'Every 2 days', sub: 'Next kid every other day' },
  { value: 'weekly', label: 'Weekly', sub: 'Next kid each week' },
  { value: 'after_done', label: 'After done', sub: 'Next kid after each approval' },
];
const blank = (): Omit<Chore, 'id'> => ({ name: '', emoji: '🧹', instruction: '', kidIds: [], recurrence: 'daily', days: [], rotation: 'none', required: true, photoProof: true, proofType: 'photo' });
const blankCritical = (kidId: string): CriticalDraft => ({
  kidId, title: '', emoji: '🐶', firstFire: '14:00', repeatMinutes: 120,
  lockAfterMin: 5, broadcastAfterMin: 15, lockAllAfterMin: 30, followupDelayMin: 15, active: true,
});
const fmtEvery = (min: number) => (min % 60 === 0 ? `${min / 60} hr${min > 60 ? 's' : ''}` : `${min} min`);

/** Keep only the final emoji (grapheme cluster) typed — never split surrogate pairs. */
const lastGrapheme = (v: string) => {
  const t = v.trim();
  if (!t) return '';
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const parts = [...new Intl.Segmenter().segment(t)];
    return parts.length ? parts[parts.length - 1].segment : '';
  }
  const chars = [...t];
  return chars[chars.length - 1] ?? '';
};

export const fmtDue = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); const d = new Date(); d.setHours(h, m); return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };

export default function Chores() {
  const s = useStore();
  const [editing, setEditing] = useState<(Omit<Chore, 'id'> & { id?: string }) | null>(null);
  const [editingCritical, setEditingCritical] = useState<CriticalDraft | null>(null);

  if (editing) return <ChoreForm value={editing} onChange={setEditing} onCancel={() => setEditing(null)} onSave={() => { s.saveChore(editing); setEditing(null); }} />;
  if (editingCritical) return <CriticalForm value={editingCritical} onChange={setEditingCritical} onCancel={() => setEditingCritical(null)} onSave={() => { s.saveCriticalTask(editingCritical); setEditingCritical(null); }} />;

  return (
    <div className="screen">
      <div className="row row--between"><h1>Chores</h1><button className="btn btn--pill" onClick={() => setEditing(blank())}>+ New chore</button></div>
      <div className="col">
        {s.chores.map((c) => (
          <button key={c.id} className={`card card--chore ${c.required ? '' : 'is-bonus'}`} onClick={() => setEditing({ ...c })}>
            <span className="chore-emoji">{c.emoji}</span>
            <div className="spacer">
              <div className="chore-title">{c.name}</div>
              <div className="chore-sub">
                {c.recurrence === 'daily' ? 'Daily' : c.recurrence === 'weekdays' ? 'Weekdays' : c.days.map((d) => DAYS[d]).join(' ')}
                {c.rotation !== 'none' && ` · rotates ${ROTATIONS.find((r) => r.value === c.rotation)?.label.toLowerCase()}`}
                {c.dueTime && ` · due ${fmtDue(c.dueTime)}`}
                {` · ${c.required ? 'Required' : 'Bonus'}`}
              </div>
            </div>
            <div className="row" style={{ gap: -4 }}>{c.kidIds.map((id) => { const k = s.kids.find((x) => x.id === id); return k ? <Avatar key={id} kid={k} size="sm" /> : null; })}</div>
          </button>
        ))}
      </div>

      <div className="row row--between" style={{ marginTop: 8 }}>
        <div className="section-label" style={{ margin: 0 }}>🚨 Critical tasks</div>
        <button className="btn btn--pill" disabled={s.kids.length === 0} onClick={() => setEditingCritical(blankCritical(s.kids[0].id))}>+ New critical</button>
      </div>
      <p className="hint" style={{ textAlign: 'left', margin: 0 }}>Must-do jobs on a timer. Late = internet starts shutting off, then it goes out to everyone.</p>
      <div className="col">
        {s.criticalTasks.map((t) => {
          const k = s.kids.find((x) => x.id === t.kidId);
          const round = s.criticalInstances.find((ci) => ci.taskId === t.id && ci.status === 'open');
          const late = round ? Math.max(0, Math.floor(criticalLateMin(round))) : 0;
          return (
            <div key={t.id} className={`card card--chore ${t.active ? '' : 'is-bonus'}`} style={{ flexWrap: 'wrap' }}>
              <button className="row spacer" style={{ gap: 12, textAlign: 'left' }} onClick={() => setEditingCritical({ ...t })}>
                <span className="chore-emoji">{t.emoji}</span>
                <div className="spacer">
                  <div className="chore-title">{t.title}{!t.active && ' · paused'}</div>
                  <div className="chore-sub">
                    Fires {fmtDue(t.firstFire)}{t.repeatMinutes ? ` · every ${fmtEvery(t.repeatMinutes)}` : ' · once a day'}
                    {t.windowEnd && ` until ${fmtDue(t.windowEnd)}`}{t.followupTitle && ` · then “${t.followupTitle}”`}
                  </div>
                </div>
                {k && <Avatar kid={k} size="sm" />}
              </button>
              {round && (
                <div className="row" style={{ width: '100%', gap: 8, alignItems: 'center' }}>
                  <span className="chore-sub" style={{ color: late >= t.lockAfterMin ? 'var(--danger)' : undefined, fontWeight: 700 }}>
                    {round.kind === 'followup' ? '↩️' : '⏰'} {round.title} — {late < 1 ? 'just fired' : `${late} min late`}
                    {round.level >= 3 ? ' · everyone locked' : round.level >= 2 ? ' · sent to everyone' : round.level >= 1 ? ` · ${k?.name ?? 'kid'} locked` : ''}
                  </span>
                  <span className="spacer" />
                  <button className="btn btn--outline" style={{ borderWidth: 1 }} onClick={() => s.cancelCritical(round.id)}>Dismiss</button>
                  <button className="btn btn--pill" onClick={() => s.completeCritical(round.id)}>Mark done</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CriticalForm({ value, onChange, onCancel, onSave }: { value: CriticalDraft; onChange: (v: CriticalDraft) => void; onCancel: () => void; onSave: () => void }) {
  const s = useStore();
  const set = (patch: Partial<CriticalDraft>) => onChange({ ...value, ...patch });
  const valid = value.title.trim() && value.kidId;
  const REPEATS: [number | undefined, string][] = [[undefined, 'Once a day'], [60, 'Hourly'], [90, '90 min'], [120, '2 hrs'], [180, '3 hrs'], [240, '4 hrs']];

  return (
    <div className="screen">
      <div className="row row--between">
        <button className="btn btn--text" onClick={onCancel}>Cancel</button>
        <h3>{value.id ? 'Edit critical task' : 'New critical task'}</h3>
        <button className="btn btn--text" disabled={!valid} onClick={onSave}>Save</button>
      </div>

      <div className="section-label">Task</div>
      <div className="row">
        <input className="field" style={{ width: 64, textAlign: 'center', fontSize: 22 }} value={value.emoji} onChange={(e) => set({ emoji: lastGrapheme(e.target.value) || value.emoji })} />
        <input className="field" placeholder="Take the dogs out" value={value.title} onChange={(e) => set({ title: e.target.value })} autoFocus />
      </div>
      <input className="field" placeholder="Note pushed with it (optional)" value={value.note ?? ''} onChange={(e) => set({ note: e.target.value || undefined })} />

      <div className="section-label">Whose job</div>
      <div className="assign-chips">
        {s.kids.map((k) => (
          <button key={k.id} className={`assign-chip ${value.kidId === k.id ? 'selected' : ''}`} onClick={() => set({ kidId: k.id })}>
            <Avatar kid={k} size="sm" />{k.name}{value.kidId === k.id && ' ✓'}
          </button>
        ))}
      </div>

      <div className="section-label">Schedule</div>
      <div className="row">
        <input className="field" type="time" style={{ width: 130 }} value={value.firstFire} onChange={(e) => set({ firstFire: e.target.value || value.firstFire })} />
        <select className="field" value={value.repeatMinutes ?? ''} onChange={(e) => set({ repeatMinutes: e.target.value ? Number(e.target.value) : undefined })}>
          {REPEATS.map(([v, label]) => <option key={label} value={v ?? ''}>{label}</option>)}
        </select>
      </div>
      {value.repeatMinutes && (
        <div className="row">
          <span className="chore-sub" style={{ whiteSpace: 'nowrap' }}>No more after</span>
          <input className="field" type="time" style={{ width: 130 }} value={value.windowEnd ?? ''} onChange={(e) => set({ windowEnd: e.target.value || undefined })} />
          {value.windowEnd && <button className="btn btn--text" onClick={() => set({ windowEnd: undefined })}>Clear</button>}
        </div>
      )}
      <p className="hint" style={{ textAlign: 'left', margin: 0 }}>
        First round fires at {fmtDue(value.firstFire)}{value.repeatMinutes ? `; the next fires ${fmtEvery(value.repeatMinutes)} after each one is done` : ''}
        {value.windowEnd ? `, until ${fmtDue(value.windowEnd)}` : ''}. Marked away = exempt from the everyone-lock.
      </p>

      <div className="section-label">When it's late</div>
      <div className="group">
        {([
          ['lockAfterMin', '📵 Their internet shuts off', 'lockAfterMin'],
          ['broadcastAfterMin', '📣 Goes out to every kid', 'broadcastAfterMin'],
          ['lockAllAfterMin', '🚫 Everyone home is locked', 'lockAllAfterMin'],
        ] as const).map(([key, label]) => (
          <div key={key} className="group-row">
            <div className="spacer"><div className="title">{label}</div></div>
            <div className="row" style={{ gap: 6 }}>
              <input className="field" type="number" min={1} style={{ width: 72, textAlign: 'center' }} value={value[key]} onChange={(e) => set({ [key]: Math.max(1, Number(e.target.value) || 1) } as Partial<CriticalDraft>)} />
              <span className="chore-sub">min</span>
            </div>
          </div>
        ))}
      </div>

      <div className="section-label">Follow-up (optional)</div>
      <input className="field" placeholder="Bring the dogs back in" value={value.followupTitle ?? ''} onChange={(e) => set({ followupTitle: e.target.value || undefined })} />
      {value.followupTitle && (
        <div className="row">
          <span className="chore-sub" style={{ whiteSpace: 'nowrap' }}>Fires</span>
          <input className="field" type="number" min={1} style={{ width: 72, textAlign: 'center' }} value={value.followupDelayMin} onChange={(e) => set({ followupDelayMin: Math.max(1, Number(e.target.value) || 15) })} />
          <span className="chore-sub">min after it's marked done — same late rules.</span>
        </div>
      )}

      {value.id && (
        <div className="group">
          <div className="group-row">
            <div className="spacer"><div className="title">Active</div><div className="sub">Off pauses it and cancels any round in flight.</div></div>
            <Switch on={value.active} onChange={(v) => set({ active: v })} />
          </div>
        </div>
      )}

      <div className="spacer" />
      {value.id && <button className="btn btn--text" style={{ color: 'var(--danger)' }} onClick={() => { s.deleteCriticalTask(value.id!); onCancel(); }}>Delete this task</button>}
      <button className="btn btn--primary" disabled={!valid} onClick={onSave}>Save critical task</button>
    </div>
  );
}

function ChoreForm({ value, onChange, onCancel, onSave }: { value: Omit<Chore, 'id'> & { id?: string }; onChange: (v: Omit<Chore, 'id'> & { id?: string }) => void; onCancel: () => void; onSave: () => void }) {
  const s = useStore();
  const set = (patch: Partial<Chore>) => onChange({ ...value, ...patch });
  const toggleKid = (id: string) => set({ kidIds: value.kidIds.includes(id) ? value.kidIds.filter((k) => k !== id) : [...value.kidIds, id] });
  const toggleDay = (d: number) => set({ days: value.days.includes(d) ? value.days.filter((x) => x !== d) : [...value.days, d].sort() });
  const valid = value.name.trim() && value.kidIds.length > 0 && (value.recurrence !== 'custom' || value.days.length > 0);
  const canRotate = value.kidIds.length > 1;

  return (
    <div className="screen">
      <div className="row row--between">
        <button className="btn btn--text" onClick={onCancel}>Cancel</button>
        <h3>{value.id ? 'Edit chore' : 'New chore'}</h3>
        <button className="btn btn--text" disabled={!valid} onClick={onSave}>Save</button>
      </div>

      <div className="section-label">Chore name</div>
      <div className="row">
        <input className="field" style={{ width: 64, textAlign: 'center', fontSize: 22 }} value={value.emoji} onChange={(e) => set({ emoji: lastGrapheme(e.target.value) || value.emoji })} />
        <input className="field" placeholder="Feed the dog" value={value.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
      </div>
      <input className="field" placeholder="Photo instruction, e.g. “Show the full bowl”" value={value.instruction ?? ''} onChange={(e) => set({ instruction: e.target.value })} />

      <div className="section-label">Assign to</div>
      {s.kids.length === 0 ? (
        <p className="hint" style={{ textAlign: 'left', margin: 0 }}>⚠️ No kids yet — add one in Settings → Kids first. A chore needs at least one kid assigned.</p>
      ) : (
        <div className="assign-chips">
          {s.kids.map((k) => (
            <button key={k.id} className={`assign-chip ${value.kidIds.includes(k.id) ? 'selected' : ''}`} onClick={() => toggleKid(k.id)}>
              <Avatar kid={k} size="sm" />{k.name}{value.kidIds.includes(k.id) && ' ✓'}
            </button>
          ))}
        </div>
      )}

      {canRotate && (
        <>
          <div className="section-label">Who does it</div>
          <div className="seg seg--wrap">
            {ROTATIONS.map((r) => <button key={r.value} className={value.rotation === r.value ? 'active' : ''} onClick={() => set({ rotation: r.value })}>{r.label}</button>)}
          </div>
          <p className="hint" style={{ textAlign: 'left', margin: 0 }}>{ROTATIONS.find((r) => r.value === value.rotation)?.sub}{value.rotation !== 'none' && ' — kids marked away are skipped.'}</p>
        </>
      )}

      <div className="section-label">Repeats</div>
      <div className="seg">
        {(['daily', 'weekdays', 'custom'] as Recurrence[]).map((r) => <button key={r} className={value.recurrence === r ? 'active' : ''} onClick={() => set({ recurrence: r })}>{r[0].toUpperCase() + r.slice(1)}</button>)}
      </div>
      {value.recurrence === 'custom' && <div className="days">{DAYS.map((d, i) => <button key={i} className={`day ${value.days.includes(i) ? 'selected' : ''}`} onClick={() => toggleDay(i)}>{d}</button>)}</div>}

      <div className="section-label">Due time</div>
      <div className="row">
        <input className="field" type="time" style={{ width: 140 }} value={value.dueTime ?? ''} onChange={(e) => set({ dueTime: e.target.value || undefined })} />
        {value.dueTime && <button className="btn btn--text" onClick={() => set({ dueTime: undefined })}>Clear</button>}
      </div>
      <p className="hint" style={{ textAlign: 'left', margin: 0 }}>
        {value.dueTime
          ? `Wi-Fi stays on until ${fmtDue(value.dueTime)} — after that it shuts off until this chore is approved.`
          : 'No due time: this chore blocks Wi-Fi all day until it’s approved (resets at midnight).'}
      </p>

      <div className="group">
        <div className="group-row"><div className="spacer"><div className="title">Required for Wi-Fi unlock</div><div className="sub">Off = bonus chore. Bonus chores never block Wi-Fi.</div></div><Switch on={value.required} onChange={(v) => set({ required: v })} /></div>
        <div className="group-row"><div className="spacer"><div className="title">Proof required</div><div className="sub">Kid must capture live proof in the app to submit.</div></div><Switch on={value.photoProof} onChange={(v) => set({ photoProof: v })} /></div>
        {value.photoProof && (
          <div className="group-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div className="seg">
              {([['photo', '📷 Photo'], ['video', '🎥 Video'], ['photo_video', 'Both']] as [Chore['proofType'], string][]).map(([v, label]) => (
                <button key={v} className={value.proofType === v ? 'active' : ''} onClick={() => set({ proofType: v })}>{label}</button>
              ))}
            </div>
            <div className="sub">{value.proofType === 'photo' ? 'A live photo.' : value.proofType === 'video' ? 'A live video, 10 seconds max.' : 'Both a live photo and a 10-second video.'}</div>
          </div>
        )}
      </div>

      <div className="spacer" />
      {!valid && (
        <p className="hint" style={{ margin: 0 }}>
          To save: {[
            !value.name.trim() && 'give it a name',
            value.kidIds.length === 0 && 'assign at least one kid',
            value.recurrence === 'custom' && value.days.length === 0 && 'pick the days it repeats',
          ].filter(Boolean).join(' · ')}
        </p>
      )}
      <button className="btn btn--primary" disabled={!valid} onClick={onSave}>Save chore</button>
    </div>
  );
}
