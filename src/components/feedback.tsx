/**
 * Action-feedback pieces from the ChoreKey refinement handoff:
 * confetti (unlock moment), floating point/streak pills, and pull-to-refresh.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { KeyGlyph } from './ui';

const COLORS = ['#5B5BD6', '#1F9D5B', '#E8B931', '#E5541E'];

/** ~16 pieces fall from the top; runs 2 cycles then unmounts itself via onDone. */
export function Confetti({ onDone }: { onDone?: () => void }) {
  const pieces = useRef(
    Array.from({ length: 16 }, (_, n) => ({
      left: (n * 61 + 13) % 100,
      color: COLORS[n % COLORS.length],
      dot: n % 3 === 2,
      dur: 2.2 + ((n * 7) % 10) / 11,
      delay: ((n * 13) % 8) / 10,
    })),
  ).current;
  useEffect(() => {
    const t = setTimeout(() => onDone?.(), 2 * 3200);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="confetti" aria-hidden>
      {[0, 1].map((cycle) =>
        pieces.map((p, n) => (
          <i
            key={`${cycle}-${n}`}
            className={p.dot ? 'c-dot' : ''}
            style={{ left: `${p.left}%`, background: p.color, animationDuration: `${p.dur}s`, animationDelay: `${p.delay + cycle * 2.8}s` }}
          />
        )),
      )}
    </div>
  );
}

/** Transient `+15 ⭐` / `+1 🔥` pill that floats up from its anchor. Parent must be position:relative. */
export function FloatPill({ text }: { text: string }) {
  return <span className="float-pill" style={{ top: -6 }}>{text}</span>;
}

/** Fires `children` pills keyed by id; helper hook to queue transient pills. */
export function useFloatPills() {
  const [pills, setPills] = useState<{ id: number; text: string }[]>([]);
  const fire = (text: string) => {
    const id = Date.now() + Math.random();
    setPills((cur) => [...cur, { id, text }]);
    setTimeout(() => setPills((cur) => cur.filter((p) => p.id !== id)), 2700);
  };
  return { pills, fire };
}

/**
 * Touch pull-to-refresh: drag down from the top of the page to reveal a spinning
 * key, release past the threshold to trigger `onRefresh`.
 */
export function PullToRefresh({ onRefresh, caption = 'Checking chores…', children }: { onRefresh?: () => Promise<void>; caption?: string; children: ReactNode }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const startY = useRef<number | null>(null);
  const THRESHOLD = 60, MAX = 86;

  if (!onRefresh) return <>{children}</>;

  const onTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY <= 0 && !busy) startY.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null || busy) return;
    const dy = e.touches[0].clientY - startY.current;
    if (window.scrollY > 0 || dy <= 0) { setPull(0); return; }
    setPull(Math.min(MAX, dy * 0.5));
  };
  const onTouchEnd = () => {
    const trigger = pull >= THRESHOLD;
    startY.current = null;
    if (!trigger) { setPull(0); return; }
    setBusy(true); setPull(MAX);
    void onRefresh().finally(() => { setBusy(false); setPull(0); });
  };

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div className="ptr" style={{ height: pull }}>
        <div className="ptr-circle"><span className={busy || pull >= THRESHOLD ? 'spin' : ''} style={{ display: 'grid', placeItems: 'center' }}><KeyGlyph size={20} /></span></div>
        <span className="ptr-cap">{caption}</span>
      </div>
      <div style={{ transform: busy ? 'translateY(4px)' : undefined, transition: 'transform .2s' }}>{children}</div>
    </div>
  );
}
