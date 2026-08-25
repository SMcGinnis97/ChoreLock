import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { useStore, type QuestDraft } from '../../lib/store';
import { Avatar, Icon, todayLabel } from '../../components/ui';
import type { Kid, ProofMedia } from '../../lib/types';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const dataUrlToMedia = async (dataUrl: string): Promise<ProofMedia> => ({
  blob: await (await fetch(dataUrl)).blob(), ext: 'jpg', contentType: 'image/jpeg', previewUrl: dataUrl, isVideo: false,
});

export default function Dashboard() {
  const s = useStore();
  const nav = useNavigate();
  const [awayFor, setAwayFor] = useState<Kid | null>(null);
  const [questDraft, setQuestDraft] = useState<QuestDraft | null>(null);
  const pendingFor = (kidId: string) => s.instances.filter((i) => i.kidId === kidId && i.status === 'submitted').length;
  const queue = s.instances.filter((i) => i.status === 'submitted');
  const questQueue = s.quests.filter((q) => q.status === 'submitted');
  const activeQuests = s.quests.filter((q) => q.status !== 'approved' && q.status !== 'rejected');

  const markAway = (until: string | null) => { if (awayFor) s.setAbsent(awayFor.id, until); setAwayFor(null); };
  const fmtAway = (until: string) => until >= '9999' ? 'until further notice' : `through ${new Date(until + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;

  return (
    <div className="screen">
      <div className="row row--between">
        <div><div className="date">{todayLabel()}</div><h1 style={{ fontSize: 27 }}>Today</h1></div>
        {s.pendingCount > 0 && <Link to="/parent/approvals" className="btn btn--tint">{s.pendingCount} to review →</Link>}
      </div>

      <div className="kid-grid">
        {s.kids.map((k) => {
          const p = s.requiredProgress(k.id);
          const lock = s.kidLockState(k.id);
          const pend = pendingFor(k.id);
          const full = p.total > 0 && p.done === p.total;
          return (
            <div key={k.id} className="card kid-card">
              <div className="row">
                <Avatar kid={k} size="lg" />
                <div className="spacer"><div className="kid-name">{k.name}</div><div className="kid-sub">{k.absentUntil ? `🏖️ Away ${fmtAway(k.absentUntil)}` : `${p.done} of ${p.total} approved · ⭐ ${k.points} pts`}</div></div>
                <span className={`wifi-pill ${lock === 'unlocked' ? 'wifi-pill--on' : 'wifi-pill--off'}`}><span className="dot" />{lock === 'unlocked' ? 'Unlocked' : 'Locked'}{k.override ? ' · manual' : ''}</span>
              </div>
              <div className="progress"><div className={full ? 'full' : ''} style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} /></div>
              <div className="row row--between">
                {pend ? <Link to="/parent/approvals" className="pending">① {pend} pending review</Link> : <span className="quiet">Nothing pending</span>}
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn--outline" style={{ borderWidth: 1 }} onClick={() => (k.absentUntil ? s.setAbsent(k.id, null) : setAwayFor(k))}>{k.absentUntil ? 'Back home' : 'Away'}</button>
                  {lock === 'unlocked'
                    ? <button className="btn btn--outline-danger" style={{ borderWidth: 1 }} onClick={() => { if (confirm(`Lock ${k.name}’s devices now?`)) s.override(k.id, 'lock'); }}>Lock now</button>
                    : <button className="btn btn--outline-ok" onClick={() => s.override(k.id, 'unlock')}>Unlock now</button>}
                </div>
              </div>
              {k.override && <button className="btn btn--text" style={{ alignSelf: 'flex-start', minHeight: 0 }} onClick={() => s.override(k.id, null)}>Clear manual override</button>}
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
                  <div style={{ width: 74, height: 74, borderRadius: 12, overflow: 'hidden', flexShrink: 0, background: 'repeating-linear-gradient(135deg,#D8D4CC 0 8px,#E8E5DF 8px 16px)' }}>{i.photoUrl && (i.isVideo ? <video src={i.photoUrl} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <img src={i.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)}</div>
                  <div className="spacer"><div style={{ fontWeight: 800 }}>{k.name} · {c.name}</div><div className="kid-sub">{i.submittedAt} · attempt {i.attempt}</div></div>
                  <button className="icon-btn" style={{ background: 'var(--danger-tint)', color: 'var(--danger)' }} onClick={() => nav('/parent/approvals')}><Icon.X size={20} /></button>
                  <button className="icon-btn" style={{ background: 'var(--ok-tint)', color: 'var(--ok-text)' }} onClick={() => s.approve(i.id)}><Icon.Check size={20} /></button>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="row row--between"><span className="section-label">⭐ Side quests</span><button className="btn btn--pill" onClick={() => setQuestDraft({ title: '', points: 5, kidId: null })}>+ Drop a quest</button></div>
      {activeQuests.length === 0 && questQueue.length === 0 && <p className="quiet" style={{ margin: 0 }}>Extra jobs kids can claim for bonus points. Drop one in passing — add a photo so they know what you mean.</p>}
      <div className="col">
        {activeQuests.map((q) => {
          const k = q.kidId ? s.kids.find((x) => x.id === q.kidId) : null;
          return (
            <div key={q.id} className="card row" style={{ padding: 12 }}>
              {q.promptUrl && <div style={{ width: 56, height: 56, borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}><img src={q.promptUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>}
              <div className="spacer">
                <div style={{ fontWeight: 800 }}>{q.title} <span className="chip chip--bonus">⭐ {q.points}</span></div>
                <div className="kid-sub">{q.status === 'open' ? 'Open — first kid to claim it' : q.status === 'submitted' ? `${k?.name ?? '?'} submitted proof` : `${k?.name ?? '?'} is on it`}</div>
              </div>
              {q.status === 'submitted'
                ? <button className="btn btn--tint" onClick={() => nav('/parent/approvals')}>Review</button>
                : <button className="btn btn--text" onClick={() => setQuestDraft({ id: q.id, title: q.title, note: q.note, points: q.points, kidId: q.kidId })}>Edit</button>}
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

      {questDraft && <QuestSheet draft={questDraft} onChange={setQuestDraft} onClose={() => setQuestDraft(null)} onSave={() => { s.saveQuest(questDraft); setQuestDraft(null); }} />}
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
      if (r.dataUrl) set({ promptMedia: await dataUrlToMedia(r.dataUrl) });
    } else fileRef.current?.click();
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const dataUrl = await new Promise<string>((res) => { const rd = new FileReader(); rd.onload = () => res(rd.result as string); rd.readAsDataURL(f); });
    set({ promptMedia: await dataUrlToMedia(dataUrl) });
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
        <button className="btn btn--outline" onClick={attach}>{draft.promptMedia ? '📸 Photo attached — retake' : '📸 Add a photo of it (optional)'}</button>
        {draft.promptMedia && <img src={draft.promptMedia.previewUrl} alt="" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 14 }} />}
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
