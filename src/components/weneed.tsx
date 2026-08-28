/**
 * Shared "We need" list — used the moment someone kills the milk. Anyone (kid or
 * parent) adds items. Checking things off ("got it") is parent-only — it means a
 * grown-up actually bought it — and a kid can remove only their own additions.
 * Rendered on both KidHome and the parent Dashboard.
 */
import { useState } from 'react';
import { useStore } from '../lib/store';

export default function WeNeedCard() {
  const s = useStore();
  const [text, setText] = useState('');
  const open = s.listItems.filter((x) => !x.doneAt);
  const done = s.listItems.filter((x) => !!x.doneAt);
  const parent = s.role === 'parent';
  const add = () => { const t = text.trim(); if (t) { s.addListItem(t); setText(''); } };
  const who = (kidId?: string) => (kidId ? s.kids.find((k) => k.id === kidId)?.name ?? '' : '👤');
  const mine = (kidId?: string) => !parent && !!kidId && kidId === s.currentKidId;

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="section-label" style={{ margin: 0 }}>🛒 We need</div>
      <div className="row">
        <input className="field spacer" placeholder="Used the last of something? Add it" value={text} maxLength={120}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <button className="btn btn--pill" disabled={!text.trim()} onClick={add}>Add</button>
      </div>
      {open.length === 0 && done.length === 0 && (
        <p className="hint" style={{ textAlign: 'left', margin: 0 }}>Empty — nice. Whoever shops next sees this list.</p>
      )}
      {open.map((item) => (
        <div key={item.id} className="row">
          {parent
            ? <button aria-label="Got it" onClick={() => s.setListItemDone(item.id, true)}
                style={{ width: 26, height: 26, borderRadius: 8, border: '2px solid var(--border)', background: 'none', flexShrink: 0, cursor: 'pointer' }} />
            : <span aria-hidden style={{ width: 26, height: 26, borderRadius: 8, border: '2px dashed var(--border)', flexShrink: 0, opacity: .5 }} />}
          <div className="spacer" style={{ fontWeight: 700 }}>{item.text}</div>
          <span className="kid-sub">{who(item.addedByKid)}</span>
          {mine(item.addedByKid) && (
            <button className="icon-btn" aria-label="Remove my item" style={{ width: 26, height: 26, background: 'var(--danger-tint)', color: 'var(--danger)', fontWeight: 800 }}
              onClick={() => s.removeListItem(item.id)}>×</button>
          )}
        </div>
      ))}
      {done.map((item) => (
        <div key={item.id} className="row" style={{ opacity: .55 }}>
          {parent
            ? <button aria-label="Un-check" onClick={() => s.setListItemDone(item.id, false)}
                style={{ width: 26, height: 26, borderRadius: 8, border: 'none', background: 'var(--ok-tint, #DBEFE8)', color: 'var(--ok-text, #0D9488)', fontWeight: 800, flexShrink: 0, cursor: 'pointer' }}>✓</button>
            : <span aria-hidden style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--ok-tint, #DBEFE8)', color: 'var(--ok-text, #0D9488)', fontWeight: 800, flexShrink: 0, display: 'grid', placeItems: 'center' }}>✓</span>}
          <div className="spacer" style={{ textDecoration: 'line-through' }}>{item.text}</div>
          {parent && <button className="btn btn--text" onClick={() => s.removeListItem(item.id)}>Clear</button>}
        </div>
      ))}
      {!parent && open.length > 0 && <p className="hint" style={{ textAlign: 'left', margin: 0, opacity: .7 }}>A parent checks things off once they’re bought. You can remove your own items with ×.</p>}
    </div>
  );
}
