/**
 * Assign board — the "who does what" half of the Chores tab. The library holds the
 * chore definitions; this board hands them out without reopening the full form:
 *   · Chore lists: named sets that rotate between kids weekly (List A is Child A's
 *     this week, Child B's next) with a manual "Swap now".
 *   · Per-kid columns for pinned chores, a Shared section for multi-kid/rotating
 *     ones, and an Unassigned pool. Tap any card to move it.
 */
import { useState } from 'react';
import { groupTurnKid, useStore } from '../../lib/store';
import { Avatar } from '../../components/ui';
import type { Chore, ChoreGroup, Rotation } from '../../lib/types';

const ROTATIONS: { value: Rotation; label: string }[] = [
  { value: 'none', label: 'Everyone' },
  { value: 'daily', label: 'Daily' },
  { value: 'every_other_day', label: 'Every 2 days' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'after_done', label: 'After done' },
];

type GroupDraft = { id?: string; name: string; emoji: string; kidIds: string[]; choreIds: string[] };

export default function AssignBoard({ onEditChore }: { onEditChore: (c: Chore) => void }) {
  const s = useStore();
  const [moving, setMoving] = useState<Chore | null>(null);
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);

  const grouped = (c: Chore) => !!c.groupId && s.groups.some((g) => g.id === c.groupId);
  const pinned = (kidId: string) => s.chores.filter((c) => !grouped(c) && c.kidIds.length === 1 && c.kidIds[0] === kidId);
  const shared = s.chores.filter((c) => !grouped(c) && c.kidIds.length > 1);
  const unassigned = s.chores.filter((c) => !grouped(c) && c.kidIds.length === 0);
  const openGroup = (g: ChoreGroup) => setGroupDraft({ id: g.id, name: g.name, emoji: g.emoji, kidIds: [...g.kidIds], choreIds: s.chores.filter((c) => c.groupId === g.id).map((c) => c.id) });

  const ChoreCard = ({ c, sub }: { c: Chore; sub?: string }) => (
    <button className={`card card--chore ${c.required ? '' : 'is-bonus'}`} style={{ padding: 10 }} onClick={() => setMoving({ ...c })}>
      <span className="chore-emoji">{c.emoji}</span>
      <div className="spacer">
        <div className="chore-title" style={{ fontSize: 15 }}>{c.name}</div>
        {sub && <div className="chore-sub">{sub}</div>}
      </div>
      <span className="chip chip--todo" style={{ fontSize: 10 }}>Move</span>
    </button>
  );

  return (
    <>
      <div className="row row--between" style={{ marginTop: 4 }}>
        <div className="section-label" style={{ margin: 0 }}>📋 Chore lists — trade weekly</div>
        <button className="btn btn--pill" onClick={() => setGroupDraft({ name: '', emoji: '📋', kidIds: [], choreIds: [] })}>+ New list</button>
      </div>
      {s.groups.length === 0 && <p className="hint" style={{ textAlign: 'left', margin: 0 }}>Bundle chores into a list, put two kids on it, and they trade the whole list every week — no by-hand shuffling.</p>}
      <div className="col">
        {s.groups.map((g) => {
          const turn = groupTurnKid(g, s.kids);
          const turnKid = s.kids.find((k) => k.id === turn);
          const next = turn && g.kidIds.length > 1 ? s.kids.find((k) => k.id === g.kidIds[(g.kidIds.indexOf(turn) + 1) % g.kidIds.length]) : undefined;
          const members = s.chores.filter((c) => c.groupId === g.id);
          return (
            <div key={g.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="row">
                <span className="chore-emoji">{g.emoji}</span>
                <div className="spacer">
                  <div className="chore-title">{g.name}</div>
                  <div className="chore-sub">
                    {turnKid ? <>This week: <strong>{turnKid.name}</strong>{next && next.id !== turnKid.id ? ` · next: ${next.name}` : ''}</> : 'No kids on this list yet'}
                  </div>
                </div>
                {g.kidIds.length > 1 && <button className="btn btn--outline" style={{ borderWidth: 1 }} onClick={() => s.advanceGroup(g.id)}>Swap now</button>}
                <button className="btn btn--text" onClick={() => openGroup(g)}>Edit</button>
              </div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {members.length === 0 && <span className="kid-sub">Empty — edit the list to add chores.</span>}
                {members.map((c) => <span key={c.id} className="chip chip--bonus">{c.emoji} {c.name}</span>)}
              </div>
            </div>
          );
        })}
      </div>

      {s.kids.map((k) => {
        const mine = pinned(k.id);
        return (
          <div key={k.id}>
            <div className="section-label"><span className="row" style={{ gap: 8, display: 'inline-flex', alignItems: 'center' }}><Avatar kid={k} size="sm" /> {k.name}’s chores</span></div>
            <div className="col">
              {mine.length === 0 && <p className="quiet" style={{ margin: 0 }}>Nothing pinned to {k.name}.</p>}
              {mine.map((c) => <ChoreCard key={c.id} c={c} />)}
            </div>
          </div>
        );
      })}

      {shared.length > 0 && (
        <>
          <div className="section-label">🔁 Shared & rotating</div>
          <div className="col">
            {shared.map((c) => (
              <ChoreCard key={c.id} c={c} sub={`${c.kidIds.map((id) => s.kids.find((x) => x.id === id)?.name).filter(Boolean).join(', ')} · ${c.rotation === 'none' ? 'everyone, every time' : `rotates ${ROTATIONS.find((r) => r.value === c.rotation)?.label.toLowerCase()}`}`} />
            ))}
          </div>
        </>
      )}

      {unassigned.length > 0 && (
        <>
          <div className="section-label">🗃️ Unassigned — waiting in the library</div>
          <div className="col">{unassigned.map((c) => <ChoreCard key={c.id} c={c} />)}</div>
        </>
      )}

      {moving && (
        <MoveSheet chore={moving} onClose={() => setMoving(null)}
          onEdit={() => { const c = moving; setMoving(null); onEditChore(c); }} />
      )}
      {groupDraft && <GroupSheet draft={groupDraft} onChange={setGroupDraft} onClose={() => setGroupDraft(null)} />}
    </>
  );
}

/** Tap-to-move: pin to one kid, share/rotate between several, drop into a list, or unassign. */
function MoveSheet({ chore, onClose, onEdit }: { chore: Chore; onClose: () => void; onEdit: () => void }) {
  const s = useStore();
  const [kidIds, setKidIds] = useState<string[]>(chore.kidIds);
  const [rotation, setRotation] = useState<Rotation>(chore.rotation);
  const [groupId, setGroupId] = useState<string | undefined>(chore.groupId);
  const toggleKid = (id: string) => { setGroupId(undefined); setKidIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])); };
  const save = () => {
    s.saveChore({ ...chore, kidIds: groupId ? [] : kidIds, rotation: kidIds.length > 1 ? rotation : 'none', groupId });
    onClose();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="handle" />
        <h2 style={{ fontSize: 22 }}>{chore.emoji} {chore.name}</h2>
        <div className="section-label" style={{ margin: 0 }}>Who does it</div>
        <div className="assign-chips">
          {s.kids.map((k) => (
            <button key={k.id} className={`assign-chip ${!groupId && kidIds.includes(k.id) ? 'selected' : ''}`} onClick={() => toggleKid(k.id)}>
              <Avatar kid={k} size="sm" />{k.name}{!groupId && kidIds.includes(k.id) && ' ✓'}
            </button>
          ))}
        </div>
        {!groupId && kidIds.length > 1 && (
          <div className="seg seg--wrap">
            {ROTATIONS.map((r) => <button key={r.value} className={rotation === r.value ? 'active' : ''} onClick={() => setRotation(r.value)}>{r.label}</button>)}
          </div>
        )}
        {s.groups.length > 0 && (
          <>
            <div className="section-label" style={{ margin: 0 }}>…or put it on a list</div>
            <div className="assign-chips">
              {s.groups.map((g) => (
                <button key={g.id} className={`assign-chip ${groupId === g.id ? 'selected' : ''}`} onClick={() => setGroupId((cur) => (cur === g.id ? undefined : g.id))}>
                  {g.emoji} {g.name}{groupId === g.id && ' ✓'}
                </button>
              ))}
            </div>
          </>
        )}
        {!groupId && kidIds.length === 0 && <p className="hint" style={{ textAlign: 'left', margin: 0 }}>No one selected — it goes back to the unassigned pool.</p>}
        <div className="row">
          <button className="btn btn--outline" style={{ flex: 1 }} onClick={onEdit}>Full editor</button>
          <button className="btn btn--primary" style={{ flex: 1.4 }} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

/** Create/edit a chore list: name, chores in it, and the kid rotation order. */
function GroupSheet({ draft, onChange, onClose }: { draft: GroupDraft; onChange: (d: GroupDraft) => void; onClose: () => void }) {
  const s = useStore();
  const set = (patch: Partial<GroupDraft>) => onChange({ ...draft, ...patch });
  const toggleKid = (id: string) => set({ kidIds: draft.kidIds.includes(id) ? draft.kidIds.filter((x) => x !== id) : [...draft.kidIds, id] });
  const toggleChore = (id: string) => set({ choreIds: draft.choreIds.includes(id) ? draft.choreIds.filter((x) => x !== id) : [...draft.choreIds, id] });
  // Chores already on ANOTHER list can't be added here (one list per chore).
  const eligible = s.chores.filter((c) => !c.groupId || c.groupId === draft.id || draft.choreIds.includes(c.id));
  const valid = draft.name.trim().length > 0;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="handle" />
        <h2 style={{ fontSize: 22 }}>{draft.id ? 'Edit chore list' : 'New chore list'}</h2>
        <div className="row">
          <input className="field" style={{ width: 64, textAlign: 'center', fontSize: 22 }} value={draft.emoji} onChange={(e) => set({ emoji: e.target.value.trim() ? [...e.target.value.trim()].slice(-2).join('') : draft.emoji })} />
          <input className="field" placeholder="Kitchen list" value={draft.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
        </div>
        <div className="section-label" style={{ margin: 0 }}>Rotation order — tap kids in turn order</div>
        <div className="assign-chips">
          {s.kids.map((k) => {
            const pos = draft.kidIds.indexOf(k.id);
            return (
              <button key={k.id} className={`assign-chip ${pos >= 0 ? 'selected' : ''}`} onClick={() => toggleKid(k.id)}>
                <Avatar kid={k} size="sm" />{pos >= 0 && <strong>{pos + 1}.</strong>} {k.name}
              </button>
            );
          })}
        </div>
        <p className="hint" style={{ textAlign: 'left', margin: 0 }}>The whole list belongs to one kid at a time and trades to the next every week (away kids are skipped).</p>
        <div className="section-label" style={{ margin: 0 }}>Chores on this list</div>
        <div className="assign-chips">
          {eligible.map((c) => (
            <button key={c.id} className={`assign-chip ${draft.choreIds.includes(c.id) ? 'selected' : ''}`} onClick={() => toggleChore(c.id)}>
              {c.emoji} {c.name}{draft.choreIds.includes(c.id) && ' ✓'}
            </button>
          ))}
          {eligible.length === 0 && <span className="kid-sub">No chores yet — create some in the library first.</span>}
        </div>
        <div className="row">
          {draft.id && <button className="btn btn--text" style={{ color: 'var(--danger)' }} onClick={() => { if (confirm('Delete this list? Its chores go back to the unassigned pool.')) { s.deleteGroup(draft.id!); onClose(); } }}>Delete</button>}
          <button className="btn btn--outline spacer" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" style={{ flex: 1.4 }} disabled={!valid} onClick={() => { s.saveGroup({ id: draft.id, name: draft.name.trim(), emoji: draft.emoji, kidIds: draft.kidIds }, draft.choreIds); onClose(); }}>Save list</button>
        </div>
      </div>
    </div>
  );
}
