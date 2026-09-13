import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useStore } from '../../lib/store';
import { Icon, ParentTabs, Wordmark } from '../../components/ui';
import { ROUTE_EVENT } from '../../native/push';

export default function ParentShell() {
  const s = useStore();
  const nav = useNavigate();
  const routerOk = s.settings.routerStatus === 'connected';
  // Tapping a parent push lands on the screen it is about (Approvals for proof, Today for asks).
  useEffect(() => {
    const onRoute = (e: Event) => { const r = (e as CustomEvent<string>).detail; if (r?.startsWith('/parent')) nav(r); };
    window.addEventListener(ROUTE_EVENT, onRoute);
    return () => window.removeEventListener(ROUTE_EVENT, onRoute);
  }, [nav]);
  return (
    <div className="parent-shell">
      <aside className="sidebar">
        <div style={{ padding: '4px 12px 16px' }}><Wordmark size={20} /></div>
        <ParentTabs pending={s.pendingCount} />
        <div className="spacer" />
        <div className={`chip ${routerOk ? 'chip--online' : 'chip--todo'}`} style={{ alignSelf: 'flex-start' }}><Icon.Router size={16} />{routerOk ? 'Router connected' : 'On-device control'}</div>
      </aside>
      <main><Outlet /></main>
      <nav className="tabbar"><ParentTabs pending={s.pendingCount} /></nav>
    </div>
  );
}
