'use client';

import { useEffect, useRef, useState } from 'react';
import { listenForOutsideDismiss } from '@/lib/outside-dismiss';

export function SessionControl({ director, onMenu, onLogout, menuLabel = '功能表', menuDanger = false }: {
  director: boolean;
  onMenu: () => void;
  onLogout: () => Promise<void>;
  menuLabel?: string;
  menuDanger?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const control = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!expanded || !control.current) return;
    menuButton.current?.focus({ preventScroll: true });
    return listenForOutsideDismiss(control.current, () => setExpanded(false));
  }, [expanded]);
  return <div ref={control} className={`identity-control ${expanded ? 'expanded' : ''}`}
    onKeyDown={e => { if (e.key === 'Escape') setExpanded(false); }}>
    {!expanded && <button type="button" className="identity-role" aria-label={`登入身分：${director ? '裁判' : '賽務'}`} aria-expanded={false} onClick={() => setExpanded(true)}>登入身分：{director ? '裁判' : '賽務'}</button>}
    {expanded && <>
      <button type="button" className="identity-logout" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await onLogout(); } finally { setBusy(false); }
      }}>{busy ? '處理中' : `${director ? '裁判' : '賽務'}登出`}</button>
      <button ref={menuButton} type="button" className={`identity-menu${menuDanger ? ' identity-menu-danger' : ''}`} onClick={() => { setExpanded(false); onMenu(); }}>{menuLabel}</button>
    </>}
  </div>;
}
