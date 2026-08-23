import { useState } from 'react';
import { useStore } from '../../lib/store';
import { Avatar, Switch } from '../../components/ui';
import type { Chore, Recurrence } from '../../lib/types';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const blank = (): Omit<Chore, 'id'> => ({ name: '', emoji: '🧹', instruction: '', kidIds: [], recurrence: 'daily', days: [], required: true, photoProof: true });

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
              <div className="chore-sub">{c.recurrence === 'daily' ? 'Daily' : c.recurrence === 'weekdays' ? 'Weekdays' : c.days.map((d) => DAYS[d]).join(' ')} · {c.required ? 'Required' : 'Bonus'}</div>
            </div>
            <div className="row" style={{ gap: -4 }}>{c.kidIds.map((id) => { const k = s.kids.find((x) => x.id === id)!; return <Avatar key={id} kid={k} size="sm" />; })}</div>
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

  return (
    <div className="screen">
      <div className="row row--between">
        <button className="btn btn--text" onClick={onCancel}>Cancel</button>
        <h3>{value.id ? 'Edit chore' : 'New chore'}</h3>
        <button className="btn btn--text" disabled={!valid} onClick={onSave}>Save</button>
      </div>

      <div className="section-label">Chore name</div>
      <div className="row">
        <input className="field" style={{ width: 64, textAlign: 'center', fontSize: 22 }} value={value.emoji} onChange={(e) => set({ emoji: e.target.value.slice(-2) })} />
        <input className="field" placeholder="Feed the dog" value={value.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
      </div>
      <input className="field" placeholder="Photo instruction, e.g. “Show the full bowl”" value={value.instruction ?? ''} onChange={(e) => set({ instruction: e.target.value })} />

      <div className="section-label">Assign to</div>
      <div className="assign-chips">
        {s.kids.map((k) => (
          <button key={k.id} className={`assign-chip ${value.kidIds.includes(k.id) ? 'selected' : ''}`} onClick={() => toggleKid(k.id)}>
            <Avatar kid={k} size="sm" />{k.name}{value.kidIds.includes(k.id) && ' ✓'}
          </button>
        ))}
      </div>

      <div className="section-label">Repeats</div>
      <div className="seg">
        {(['daily', 'weekdays', 'custom'] as Recurrence[]).map((r) => <button key={r} className={value.recurrence === r ? 'active' : ''} onClick={() => set({ recurrence: r })}>{r[0].toUpperCase() + r.slice(1)}</button>)}
      </div>
      {value.recurrence === 'custom' && <div className="days">{DAYS.map((d, i) => <button key={i} className={`day ${value.days.includes(i) ? 'selected' : ''}`} onClick={() => toggleDay(i)}>{d}</button>)}</div>}

      <div className="group">
        <div className="group-row"><div className="spacer"><div className="title">Required for Wi-Fi unlock</div><div className="sub">Off = bonus chore. Bonus chores never block Wi-Fi.</div></div><Switch on={value.required} onChange={(v) => set({ required: v })} /></div>
        <div className="group-row"><div className="spacer"><div className="title">Photo proof</div><div className="sub">Kid must snap a live photo to submit.</div></div><Switch on={value.photoProof} onChange={(v) => set({ photoProof: v })} /></div>
      </div>

      <div className="spacer" />
      <button className="btn btn--primary" disabled={!valid} onClick={onSave}>Save chore</button>
    </div>
  );
}
