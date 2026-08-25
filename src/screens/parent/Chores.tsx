import { useState } from 'react';
import { useStore } from '../../lib/store';
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
const blank = (): Omit<Chore, 'id'> => ({ name: '', emoji: '🧹', instruction: '', kidIds: [], recurrence: 'daily', days: [], rotation: 'none', required: true, photoProof: true });

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

  if (editing) return <ChoreForm value={editing} onChange={setEditing} onCancel={() => setEditing(null)} onSave={() => { s.saveChore(editing); setEditing(null); }} />;

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
        <div className="group-row"><div className="spacer"><div className="title">Photo proof</div><div className="sub">Kid must snap a live photo to submit.</div></div><Switch on={value.photoProof} onChange={(v) => set({ photoProof: v })} /></div>
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
