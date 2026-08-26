import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { isGrounded, useStore, type QuestDraft } from '../../lib/store';
import { Avatar, Icon, todayLabel } from '../../components/ui';
import { PullToRefresh } from '../../components/feedback';
import type { Kid, ProofMedia } from '../../lib/types';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const dataUrlToMedia = async (dataUrl: string): Promise<ProofMedia> => ({
  blob: await (await fetch(dataUrl)).blob(), ext: 'jpg', contentType: 'image/jpeg', previewUrl: dataUrl, isVideo: false,
});

export default function Dashboard() {
  const s = useStore();
  const nav = useNavigate();
  const [awayFor, setAwayFor] = useState<Kid | null>(null);
  const [groundFor, setGroundFor] = useState<Kid | null>(null);
  const [callOpen, setCallOpen] = useState(false);
  const [dayListFor, setDayListFor] = useState<Kid | null>(null);
  const [questDraft, setQuestDraft] = useState<QuestDraft | null>(null);
  const pendingFor = (kidId: string) => s.instances.filter((i) => i.kidId === kidId && i.status === 'submitted').length;
  const queue = s.instances.filter((i) => i.status === 'submitted');
  const questQueue = s.quests.filter((q) => q.status === 'submitted');
  const activeQuests = s.quests.filter((q) => q.status !== 'approved' && q.status !== 'rejected');

  const markAway = (until: string | null) => { if (awayFor) s.setAbsent(awayFor.id, until); setAwayFor(null); };
  const fmtAway = (until: string) => until >= '9999' ? 'until further notice' : `through ${new Date(until + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;
  const fmtGrounded = (until: string) => until >= '9999' ? 'until you lift it' : `until ${new Date(until).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;

  return (
    <PullToRefresh onRefresh={s.reload} caption="Refreshing…">
    <div className="screen">
      <div className="row row--between">
        <div><div className="date">{todayLabel()}</div><h1 style={{ fontSize: 27 }}>Today</h1></div>
        <div className="row" style={{ gap: 8 }}>
          {s.pendingCount > 0 && <Link to="/parent/approvals" className="btn btn--tint">{s.pendingCount} to review →</Link>}
          <button className="btn btn--pill" style={{ background: 'var(--warn)' }} onClick={() => setCallOpen(true)}>📢 Call</button>
        </div>
      </div>

      {(() => {
        const calls = s.summons.filter((x) => !x.canceledAt && (x.acknowledgedAt || new Date(x.expiresAt).getTime() > Date.now()));
        if (!calls.length) return null;
        return (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="section-label" style={{ margin: 0 }}>📢 Calls</div>
            {calls.map((c) => {
              const k = s.kids.find((x) => x.id === c.kidId);
              return (
                <div key={c.id} className="row">
                  <div className="spacer">
                    <div style={{ fontWeight: 800 }}>{k?.name ?? '?'} → {c.location}</div>
                    <div className="kid-sub">{c.acknowledgedAt
                      ? `✓ On the way · ${new Date(c.acknowledgedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                      : '🔔 Dinging every 30s…'}</div>
                  </div>
                  {!c.acknowledgedAt && <button className="btn btn--outline" style={{ borderWidth: 1 }} onClick={() => s.cancelSummon(c.id)}>Cancel</button>}
                </div>
              );
            })}
          </div>
        );
      })()}

      <div className="kid-grid">
        {s.kids.map((k) => {
          const p = s.requiredProgress(k.id);
          const lock = s.kidLockState(k.id);
          const pend = pendingFor(k.id);
          const full = p.total > 0 && p.done === p.total;
          const grounded = isGrounded(k);
          return (
            <div key={k.id} className="card kid-card">
              <button className="row" style={{ textAlign: 'left', width: '100%' }} onClick={() => setDayListFor(k)}>
                <Avatar kid={k} size="lg" />
                <div className="spacer"><div className="kid-name">{k.name}</div><div className="kid-sub">{grounded ? `😤 Grounded ${fmtGrounded(k.groundedUntil!)}` : k.absentUntil ? `🏖️ Away ${fmtAway(k.absentUntil)}` : `${p.done} of ${p.total} approved · ⭐ ${k.points} pts`}</div></div>
                <span className={`wifi-pill ${lock === 'unlocked' ? 'wifi-pill--on' : 'wifi-pill--off'}`}><span className="dot" />{lock === 'unlocked' ? 'Unlocked' : 'Locked'}{grounded ? ' · grounded' : k.override ? ' · manual' : ''}</span>
              </button>
              {grounded && k.groundedReason && <div className="quote" style={{ padding: '8px 12px' }}>“{k.groundedReason}”</div>}
              <div className="progress"><div className={full ? 'full' : ''} style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} /></div>
              <div className="row row--between">
                {pend ? <Link to="/parent/approvals" className="pending">① {pend} pending review</Link> : <span className="quiet">Nothing pending</span>}
                <div className="row" style={{ gap: 8 }}>
                  {grounded
                    ? <button className="btn btn--outline-ok" onClick={() => s.setGrounding(k.id, null)}>Lift grounding</button>
                    : <>
                        <button className="btn btn--outline" style={{ borderWidth: 1 }} onClick={() => (k.absentUntil ? s.setAbsent(k.id, null) : setAwayFor(k))}>{k.absentUntil ? 'Back home' : 'Away'}</button>
                        <button className="btn btn--outline-danger" style={{ borderWidth: 1 }} onClick={() => setGroundFor(k)}>Ground</button>
                        {lock === 'unlocked'
                          ? <button className="btn btn--outline-danger" style={{ borderWidth: 1 }} onClick={() => { if (confirm(`Lock ${k.name}’s devices now?`)) s.override(k.id, 'lock'); }}>Lock now</button>
                          : <button className="btn btn--outline-ok" onClick={() => s.override(k.id, 'unlock')}>Unlock now</button>}
                      </>}
                </div>
              </div>
              {k.override && !grounded && <button className="btn btn--text" style={{ alignSelf: 'flex-start', minHeight: 0 }} onClick={() => s.override(k.id, null)}>Clear manual override</button>}
            </div>
          );
        })}
      </div>

      {queue.length > 0 && (
        <>
          <div className="row row--between"><span className="section-label">Pending approvals</span><Link to="/parent/approvals">Open queue →</Link></div>
          <div className="col">
            {queue.map((i) => {
              const k = s.kids.find((x) => x.id === i.kidId)!, c = s.chores.find((x) => x.id === i.choreId)!;
              return (
                <div key={i.id} className="card row" style={{ padding: 10 }}>
                  <div style={{ width: 74, height: 74, borderRadius: 12, overflow: 'hidden', flexShrink: 0, background: 'repeating-linear-gradient(135deg,#D8D4CC 0 8px,#E8E5DF 8px 16px)' }}>{i.photoUrl ? <img src={i.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : i.videoUrl ? <video src={i.videoUrl} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}</div>
                  <div className="spacer"><div style={{ fontWeight: 800 }}>{k.name} · {c.name}</div><div className="kid-sub">{i.submittedAt} · attempt {i.attempt}</div></div>
                  <button className="icon-btn" style={{ background: 'var(--danger-tint)', color: 'var(--danger)' }} onClick={() => nav('/parent/approvals')}><Icon.X size={20} /></button>
                  <button className="icon-btn" style={{ background: 'var(--ok-tint)', color: 'var(--ok-text)' }} onClick={() => s.approve(i.id)}><Icon.Check size={20} /></button>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="row row--between"><span className="section-label">⭐ Side quests</span><button className="btn btn--pill" onClick={() => setQuestDraft({ title: '', points: 5, kidId: null, promptMedia: [] })}>+ Drop a quest</button></div>
      {activeQuests.length === 0 && questQueue.length === 0 && <p className="quiet" style={{ margin: 0 }}>Extra jobs kids can claim for bonus points. Drop one in passing — add a photo so they know what you mean.</p>}
      <div className="col">
        {activeQuests.map((q) => {
          const k = q.kidId ? s.kids.find((x) => x.id === q.kidId) : null;
          return (
            <div key={q.id} className="card row" style={{ padding: 12 }}>
              {q.promptUrls[0] && <div style={{ width: 56, height: 56, borderRadius: 10, overflow: 'hidden', flexShrink: 0, position: 'relative' }}><img src={q.promptUrls[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />{q.promptUrls.length > 1 && <span className="chip chip--todo" style={{ position: 'absolute', right: 2, bottom: 2, padding: '1px 5px', fontSize: 10 }}>+{q.promptUrls.length - 1}</span>}</div>}
              <div className="spacer">
                <div style={{ fontWeight: 800 }}>{q.title} <span className="chip chip--bonus">⭐ {q.points}</span></div>
                <div className="kid-sub">{q.status === 'open' ? 'Open — first kid to claim it' : q.status === 'submitted' ? `${k?.name ?? '?'} submitted proof` : `${k?.name ?? '?'} is on it`}</div>
              </div>
              {q.status === 'submitted'
                ? <button className="btn btn--tint" onClick={() => nav('/parent/approvals')}>Review</button>
                : <button className="btn btn--text" onClick={() => setQuestDraft({ id: q.id, title: q.title, note: q.note, points: q.points, kidId: q.kidId, promptMedia: [] })}>Edit</button>}
            </div>
          );
        })}
      </div>

      <p className="hint">Chores reset at {fmtTime(s.settings.resetTime)} · {s.settings.routerStatus === 'connected' ? 'Router connected' : 'On-device control (Screen Time)'}</p>

      {awayFor && (
        <div className="sheet-backdrop" onClick={() => setAwayFor(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="handle" />
            <h2 style={{ fontSize: 22 }}>Mark {awayFor.name} away</h2>
            <p style={{ margin: '-8px 0 0', fontWeight: 600, color: 'var(--ink-2)' }}>No chores while away, Wi-Fi stays on, streak is safe.</p>
            <button className="btn btn--outline" onClick={() => markAway(iso(new Date()))}>Just today</button>
            <button className="btn btn--outline" onClick={() => { const d = new Date(); d.setDate(d.getDate() + 6); markAway(iso(d)); }}>This week</button>
            <button className="btn btn--outline" onClick={() => markAway('9999-12-31')}>Until I turn it off</button>
            <button className="btn btn--text" onClick={() => setAwayFor(null)}>Cancel</button>
          </div>
        </div>
      )}

      {callOpen && <CallSheet onClose={() => setCallOpen(false)} onCall={(kidIds, location, note, meeting) => { s.callKids(kidIds, location, note, meeting); setCallOpen(false); }} />}

      {groundFor && <GroundSheet kid={groundFor} onClose={() => setGroundFor(null)} onGround={(until, reason) => { s.setGrounding(groundFor.id, until, reason); setGroundFor(null); }} />}

      {questDraft && <QuestSheet draft={questDraft} onChange={setQuestDraft} onClose={() => setQuestDraft(null)} onSave={() => { s.saveQuest(questDraft); setQuestDraft(null); }} />}

      {dayListFor && (
        <div className="sheet-backdrop" onClick={() => setDayListFor(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '80vh', overflowY: 'auto' }}>
            <div className="handle" />
            <h2 style={{ fontSize: 22 }}>{dayListFor.name}’s chores today</h2>
            <p style={{ margin: '-8px 0 0', fontWeight: 600, color: 'var(--ink-2)' }}>Mark things done by hand — for dead phones and other real life.</p>
            <div className="col">
              {s.instances.filter((i) => i.kidId === dayListFor.id).map((i) => {
                const c = s.chores.find((x) => x.id === i.choreId);
                if (!c) return null;
                return (
                  <div key={i.id} className="card row" style={{ padding: 10 }}>
                    <span className="chore-emoji">{c.emoji}</span>
                    <div className="spacer"><div className="chore-title">{c.name}</div><div className="chore-sub">{i.status === 'todo' ? 'Not done yet' : i.status === 'submitted' ? 'Waiting for review' : i.status === 'approved' ? 'Approved' : `Rejected — ${i.rejectionReason ?? 'redo'}`}</div></div>
                    {i.status === 'approved'
                      ? <button className="btn btn--outline" style={{ borderWidth: 1 }} onClick={() => s.reopen(i.id)}>Undo</button>
                      : <button className="btn btn--outline-ok" onClick={() => s.approve(i.id)}>Mark done</button>}
                  </div>
                );
              })}
              {s.instances.filter((i) => i.kidId === dayListFor.id).length === 0 && <p className="quiet" style={{ margin: 0 }}>No chores today.</p>}
            </div>
            <button className="btn btn--primary" onClick={() => setDayListFor(null)}>Done</button>
          </div>
        </div>
      )}
    </div>
    </PullToRefresh>
  );
}

const CALL_PLACES = ['Kitchen', 'Living room', 'Front door', 'Car', 'Backyard'];

/** Call everyone (family meeting) or specific kids to a place; dings until they acknowledge. */
function CallSheet({ onClose, onCall }: { onClose: () => void; onCall: (kidIds: string[], location: string, note: string | undefined, meeting: boolean) => void }) {
  const s = useStore();
  const [who, setWho] = useState<'all' | string[]>('all');
  const [place, setPlace] = useState('');
  const [custom, setCustom] = useState('');
  const [note, setNote] = useState('');
  const location = custom.trim() || place;
  const kidIds = who === 'all' ? s.kids.map((k) => k.id) : who;
  const toggleKid = (id: string) => setWho((cur) => {
    const list = cur === 'all' ? [] : [...cur];
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  });

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="handle" />
        <h2 style={{ fontSize: 22 }}>📢 Call the kids</h2>
        <p style={{ margin: '-8px 0 0', fontWeight: 600, color: 'var(--ink-2)' }}>Their phones ding every 30 seconds until they tap “On my way!” (stops on its own after 15 min).</p>
        <div className="section-label" style={{ margin: 0 }}>Who</div>
        <div className="assign-chips">
          <button className={`assign-chip ${who === 'all' ? 'selected' : ''}`} onClick={() => setWho('all')}>👨‍👩‍👧‍👦 Everyone — family meeting</button>
          {s.kids.map((k) => (
            <button key={k.id} className={`assign-chip ${who !== 'all' && who.includes(k.id) ? 'selected' : ''}`} onClick={() => toggleKid(k.id)}>{k.name}{who !== 'all' && who.includes(k.id) ? ' ✓' : ''}</button>
          ))}
        </div>
        <div className="section-label" style={{ margin: 0 }}>Where</div>
        <div className="reason-chips">{CALL_PLACES.map((p) => <button key={p} className={`reason-chip ${place === p && !custom.trim() ? 'selected' : ''}`} onClick={() => { setPlace(p); setCustom(''); }}>{p}</button>)}</div>
        <input className="field" placeholder="Or type a place…" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <input className="field" placeholder="Why? (optional — they see this)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="row">
          <button className="btn btn--outline" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" style={{ flex: 1.4, background: 'var(--warn)' }} disabled={!location || kidIds.length === 0} onClick={() => onCall(kidIds, location, note.trim() || undefined, who === 'all')}>📢 Call now</button>
        </div>
      </div>
    </div>
  );
}

const GROUND_REASONS = ['Attitude', 'Broke a rule', 'Homework not done', 'Missed curfew'];

/** Pick a reason (the kid sees it, with a push) and a duration; duration buttons commit. */
function GroundSheet({ kid, onClose, onGround }: { kid: Kid; onClose: () => void; onGround: (until: string, reason: string) => void }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const why = [reason, note.trim()].filter(Boolean).join(' — ');

  const ground = (until: Date | 'forever') => {
    onGround(until === 'forever' ? '9999-12-31T00:00:00.000Z' : until.toISOString(), why);
  };
  const endOfDay = () => { const d = new Date(); d.setHours(23, 59, 59, 0); return d; };
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="handle" />
        <h2 style={{ fontSize: 22 }}>Ground {kid.name}</h2>
        <p style={{ margin: '-8px 0 0', fontWeight: 600, color: 'var(--ink-2)' }}>Wi-Fi and devices lock right away — chores won’t unlock them. {kid.name} gets a notification with the reason.</p>
        <div className="reason-chips">{GROUND_REASONS.map((r) => <button key={r} className={`reason-chip ${reason === r ? 'selected' : ''}`} onClick={() => setReason(reason === r ? '' : r)}>{r}</button>)}</div>
        <textarea className="field" placeholder="Add details (the kid sees this)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="section-label" style={{ margin: 0 }}>For how long?</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn btn--outline" style={{ flex: '1 1 45%' }} disabled={!why} onClick={() => ground(endOfDay())}>Rest of today</button>
          <button className="btn btn--outline" style={{ flex: '1 1 45%' }} disabled={!why} onClick={() => ground(inDays(1))}>24 hours</button>
          <button className="btn btn--outline" style={{ flex: '1 1 45%' }} disabled={!why} onClick={() => ground(inDays(3))}>3 days</button>
          <button className="btn btn--outline" style={{ flex: '1 1 45%' }} disabled={!why} onClick={() => ground(inDays(7))}>A week</button>
          <button className="btn btn--danger-solid" style={{ flex: '1 1 100%' }} disabled={!why} onClick={() => ground('forever')}>Until I lift it</button>
        </div>
        {!why && <p className="hint" style={{ margin: 0 }}>Pick or write a reason first — kids always see why.</p>}
        <button className="btn btn--text" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function QuestSheet({ draft, onChange, onClose, onSave }: { draft: QuestDraft; onChange: (d: QuestDraft) => void; onClose: () => void; onSave: () => void }) {
  const s = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<QuestDraft>) => onChange({ ...draft, ...patch });

  const attach = async () => {
    if (Capacitor.isNativePlatform()) {
      const r = await Camera.getPhoto({ source: CameraSource.Prompt, resultType: CameraResultType.DataUrl, quality: 70, width: 1280, correctOrientation: true });
      if (r.dataUrl) set({ promptMedia: [...draft.promptMedia, await dataUrlToMedia(r.dataUrl)] });
    } else fileRef.current?.click();
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const dataUrl = await new Promise<string>((res) => { const rd = new FileReader(); rd.onload = () => res(rd.result as string); rd.readAsDataURL(f); });
    set({ promptMedia: [...draft.promptMedia, await dataUrlToMedia(dataUrl)] });
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="handle" />
        <h2 style={{ fontSize: 22 }}>{draft.id ? 'Edit side quest' : 'Drop a side quest'}</h2>
        <input className="field" placeholder="What needs doing? e.g. Sweep the garage" value={draft.title} onChange={(e) => set({ title: e.target.value })} autoFocus />
        <textarea className="field" placeholder="Details (optional)" value={draft.note ?? ''} onChange={(e) => set({ note: e.target.value })} />
        <div className="row">
          <div className="section-label" style={{ margin: 0 }}>Worth</div>
          <div className="seg" style={{ flex: 1 }}>
            {[5, 10, 15, 25].map((p) => <button key={p} className={draft.points === p ? 'active' : ''} onClick={() => set({ points: p })}>⭐ {p}</button>)}
          </div>
        </div>
        <div className="section-label" style={{ margin: 0 }}>Who</div>
        <div className="assign-chips">
          <button className={`assign-chip ${draft.kidId === null ? 'selected' : ''}`} onClick={() => set({ kidId: null })}>🙋 First to claim</button>
          {s.kids.map((k) => (
            <button key={k.id} className={`assign-chip ${draft.kidId === k.id ? 'selected' : ''}`} onClick={() => set({ kidId: k.id })}>{k.name}{draft.kidId === k.id && ' ✓'}</button>
          ))}
        </div>
        <button className="btn btn--outline" onClick={attach}>📸 {draft.promptMedia.length ? 'Add another photo' : 'Add a photo of it (optional)'}</button>
        {draft.promptMedia.length > 0 && (
          <div className="row" style={{ gap: 8, overflowX: 'auto' }}>
            {draft.promptMedia.map((m, n) => (
              <div key={n} style={{ position: 'relative', flexShrink: 0 }}>
                <img src={m.previewUrl} alt="" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 12 }} />
                <button className="icon-btn" style={{ position: 'absolute', top: -6, right: -6, width: 24, height: 24, background: 'var(--danger)', color: '#fff' }} onClick={() => set({ promptMedia: draft.promptMedia.filter((_, i) => i !== n) })}>×</button>
              </div>
            ))}
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        <div className="row">
          <button className="btn btn--outline" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" style={{ flex: 1.4 }} disabled={!draft.title.trim()} onClick={onSave}>{draft.id ? 'Save' : 'Post it'}</button>
        </div>
      </div>
    </div>
  );
}

export const fmtTime = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); const d = new Date(); d.setHours(h, m); return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
