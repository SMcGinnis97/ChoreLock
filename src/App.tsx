import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { MockStoreProvider, useStore } from './lib/store';
import { LiveStoreProvider, useIdentity } from './lib/store.live';
import { hasBackend } from './lib/supabase';
import Auth from './screens/Auth';
import KidHome from './screens/kid/KidHome';
import KidStats from './screens/kid/KidStats';
import ChoreSubmit from './screens/kid/ChoreSubmit';
import ParentShell from './screens/parent/ParentShell';
import Dashboard from './screens/parent/Dashboard';
import Approvals from './screens/parent/Approvals';
import Insights from './screens/parent/Insights';
import Chores from './screens/parent/Chores';
import Settings from './screens/parent/Settings';
import { Avatar, LogoTile, Wordmark } from './components/ui';
import SummonOverlay from './components/summon';

/** Mock-mode role/kid picker (no backend configured). */
function Welcome() {
  const s = useStore();
  const nav = useNavigate();
  return (
    <div className="screen screen--center" style={{ gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'center' }}><LogoTile size={84} /></div>
      <h1 style={{ textAlign: 'center' }}>ChoreKey</h1>
      <p style={{ margin: 0, textAlign: 'center', fontWeight: 600, color: 'var(--ink-2)' }}>Mock mode — no VITE_SUPABASE_URL set.</p>
      <div className="section-label">I’m a kid</div>
      <div className="col">
        {s.kids.map((k) => (
          <button key={k.id} className="card card--chore" onClick={() => { s.setRole('kid'); s.setCurrentKidId(k.id); nav('/kid'); }}>
            <Avatar kid={k} /><div className="spacer"><div className="chore-title">{k.name}</div><div className="chore-sub">Age {k.age}</div></div>
          </button>
        ))}
      </div>
      <div className="section-label">I’m a parent</div>
      <button className="btn btn--primary" onClick={() => { s.setRole('parent'); nav('/parent'); }}>Open parent dashboard</button>
      <p className="hint"><a href="/states">Preview empty / loading / error states</a></p>
    </div>
  );
}

function States() {
  const frame = { width: 390, border: '1px solid var(--border)', borderRadius: 24, overflow: 'hidden' } as const;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, padding: 24, justifyContent: 'center' }}>
      {(['empty', 'loading', 'error'] as const).map((st) => <div key={st} style={frame}><KidHome state={st} /></div>)}
      {(['loading', 'error'] as const).map((st) => <div key={st} style={frame}><Approvals state={st} /></div>)}
    </div>
  );
}

/** Routes once a store exists. `home` is where "/" lands. */
function AppRoutes({ home }: { home: string }) {
  const s = useStore();
  if (useSplashHold(!!s.loading)) return <Splash />;
  return (
    <>
    <SummonOverlay />
    <Routes>
      <Route path="/" element={home === '/' ? <Welcome /> : <Navigate to={home} replace />} />
      <Route path="/states" element={<States />} />
      <Route path="/kid" element={<KidHome />} />
      <Route path="/kid/stats" element={<KidStats />} />
      <Route path="/kid/submit/:id" element={<ChoreSubmit />} />
      <Route path="/kid/quest/:id" element={<ChoreSubmit quest />} />
      <Route path="/parent" element={<ParentShell />}>
        <Route index element={<Dashboard />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="insights" element={<Insights />} />
        <Route path="chores" element={<Chores />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
    </>
  );
}

/** Launch splash (Signal search): arcs pulse, wordmark + tagline fade up, dots bounce. */
const Splash = () => (
  <div className="screen screen--center splash">
    <LogoTile size={104} arcClass={(n) => `splash-arc${n}`} />
    <div className="splash-word"><Wordmark size={32} /></div>
    <p className="splash-tag">Chores first. Then the good stuff.</p>
    <div className="splash-dots"><span /><span /><span /></div>
  </div>
);

/** Keep the splash up ≥1.6s from web boot so the animation reads (shared across gates). */
const bootAt = Date.now();
function useSplashHold(active: boolean) {
  const [, force] = useState(0);
  const remaining = bootAt + 1600 - Date.now();
  useEffect(() => {
    if (!active && remaining > 0) { const t = setTimeout(() => force((n) => n + 1), remaining + 20); return () => clearTimeout(t); }
  }, [active, remaining]);
  return active || remaining > 0;
}

function LiveApp() {
  const id = useIdentity();
  if (!id.ready) return <Splash />;
  if (!id.role) return <Auth onDone={id.refresh} needsFamily={!!id.session && !id.session.user.is_anonymous} />;
  return (
    <LiveStoreProvider identity={id}>
      <AppRoutes home={id.role === 'parent' ? '/parent' : '/kid'} />
    </LiveStoreProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      {hasBackend ? <LiveApp /> : <MockStoreProvider><AppRoutes home="/" /></MockStoreProvider>}
    </BrowserRouter>
  );
}
