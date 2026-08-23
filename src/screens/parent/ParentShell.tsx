import { Outlet } from 'react-router-dom';
import { useStore } from '../../lib/store';
import { Icon, ParentTabs } from '../../components/ui';

export default function ParentShell() {
  const s = useStore();
  const routerOk = s.settings.routerStatus === 'connected';
  return (
    <div className="parent-shell">
      <aside className="sidebar">
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, padding: '4px 12px 16px' }}>🔒 ChoreKey</div>
        <ParentTabs pending={s.pendingCount} />
        <div className="spacer" />
        <div className={`chip ${routerOk ? 'chip--online' : 'chip--todo'}`} style={{ alignSelf: 'flex-start' }}><Icon.Router size={16} />{routerOk ? 'Router connected' : 'On-device control'}</div>
      </aside>
      <main><Outlet /></main>
      <nav className="tabbar"><ParentTabs pending={s.pendingCount} /></nav>
    </div>
  );
}
