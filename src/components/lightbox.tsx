/**
 * Full-screen media viewer ("blow up the picture"). From any thumbnail's onClick call
 * zoomMedia([...urls or {src,isVideo}], startIndex); <LightboxHost /> (mounted once at
 * the routes level) renders the overlay. Tap the backdrop or ✕ to close; ‹ › step
 * through multiple items. Videos play with controls.
 */
import { useEffect, useState } from 'react';

export interface ZoomItem { src: string; isVideo?: boolean }

let openFn: (items: ZoomItem[], index: number) => void = () => {};
export const zoomMedia = (items: Array<ZoomItem | string | undefined | null | false>, index = 0) => {
  const list = items.filter((x): x is ZoomItem | string => !!x).map((x) => (typeof x === 'string' ? { src: x } : x));
  if (list.length) openFn(list, Math.min(index, list.length - 1));
};

const btn: React.CSSProperties = {
  position: 'absolute', zIndex: 2, width: 44, height: 44, borderRadius: 22, border: 'none',
  background: 'rgba(255,255,255,.15)', color: '#fff', fontSize: 22, fontWeight: 700,
  display: 'grid', placeItems: 'center', cursor: 'pointer',
};

export default function LightboxHost() {
  const [state, setState] = useState<{ items: ZoomItem[]; index: number } | null>(null);
  useEffect(() => {
    openFn = (items, index) => setState({ items, index });
    return () => { openFn = () => {}; };
  }, []);
  if (!state) return null;
  const { items, index } = state;
  const item = items[index];
  const step = (d: number) => setState({ items, index: (index + d + items.length) % items.length });

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(8,8,8,.94)', display: 'grid', placeItems: 'center' }}
      onClick={() => setState(null)}
    >
      {item.isVideo
        ? <video key={item.src} src={item.src} controls autoPlay playsInline style={{ maxWidth: '100vw', maxHeight: '100vh' }} onClick={(e) => e.stopPropagation()} />
        : <img key={item.src} src={item.src} alt="" style={{ maxWidth: '100vw', maxHeight: '100vh', objectFit: 'contain' }} onClick={(e) => e.stopPropagation()} />}
      <button aria-label="Close" style={{ ...btn, top: 'calc(env(safe-area-inset-top, 0px) + 14px)', right: 14, fontSize: 18 }} onClick={() => setState(null)}>✕</button>
      {items.length > 1 && (
        <>
          <button aria-label="Previous" style={{ ...btn, left: 10, top: '50%', transform: 'translateY(-50%)' }} onClick={(e) => { e.stopPropagation(); step(-1); }}>‹</button>
          <button aria-label="Next" style={{ ...btn, right: 10, top: '50%', transform: 'translateY(-50%)' }} onClick={(e) => { e.stopPropagation(); step(1); }}>›</button>
          <span style={{ position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)', color: '#fff', fontWeight: 700, fontSize: 13, opacity: .8 }}>{index + 1} / {items.length}</span>
        </>
      )}
    </div>
  );
}
