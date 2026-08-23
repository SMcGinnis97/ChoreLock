import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { StoreProvider, useStore } from './lib/store';
import KidHome from './screens/kid/KidHome';
import ChoreSubmit from './screens/kid/ChoreSubmit';
import ParentShell from './screens/parent/ParentShell';
import Dashboard from './screens/parent/Dashboard';
import Approvals from './screens/parent/Approvals';
import Chores from './screens/parent/Chores';
import Settings from './screens/parent/Settings';
import { Avatar } from './components/ui';

/** Dev-only role/kid picker. Replaced by real auth once Supabase is wired. */
function Welcome() {
  const s = useStore();
  const nav = useNavigate();
  return (
    <div className="screen screen--center" style={{ gap: 18 }}>
      <div style={{ fontSize: 56, textAlign: 'center' }}>🔒</div>
      <h1 style={{ textAlign: 'center' }}>ChoreLock</h1>
      <p style={{ margin: 0, textAlign: 'center', fontWeight: 600, color: 'var(--ink-2)' }}>Chores first. Then the good stuff.</p>
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

export default function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Welcome />} />
          <Route path="/states" element={<States />} />
          <Route path="/kid" element={<KidHome />} />
          <Route path="/kid/submit/:id" element={<ChoreSubmit />} />
          <Route path="/parent" element={<ParentShell />}>
            <Route index element={<Dashboard />} />
            <Route path="approvals" element={<Approvals />} />
            <Route path="chores" element={<Chores />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  );
}
