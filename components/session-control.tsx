'use client';

import { useEffect, useRef, useState } from 'react';

export function SessionControl({ director, onMenu, onLogout }: {
  director: boolean;
  onMenu: () => void;
  onLogout: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (expanded) menuButton.current?.focus(); }, [expanded]);
  return <div className={`identity-control ${expanded ? 'expanded' : ''}`}
    onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setExpanded(false); }}
    onKeyDown={e => { if (e.key === 'Escape') setExpanded(false); }}>
    {!expanded && <button type="button" className="identity-role" aria-label={`登入身分：${director ? '裁判' : '賽務'}`} aria-expanded={false} onClick={() => setExpanded(true)}>登入身分：{director ? '裁判' : '賽務'}</button>}
    {expanded && <>
      <button type="button" className="identity-logout" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await onLogout(); } finally { setBusy(false); }
      }}>{busy ? '處理中' : `${director ? '裁判' : '賽務'}登出`}</button>
      <button ref={menuButton} type="button" className="identity-menu" onClick={() => { setExpanded(false); onMenu(); }}>功能表</button>
    </>}
  </div>;
}
