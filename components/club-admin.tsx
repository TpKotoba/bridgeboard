'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { PublicEvent } from '@/lib/model';

export function ClubAdmin({ event, reload }: { event: PublicEvent; reload: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [link, setLink] = useState('');
  const [qr, setQr] = useState('');
  const [pair, setPair] = useState('');
  const [reason, setReason] = useState('本圈收分完成');
  const [base, setBase] = useState('');
  useEffect(() => { setBase(location.origin); }, []);
  useEffect(() => {
    const timer = setInterval(() => { void reload().catch(e => setError((e as Error).message)); }, 10000);
    return () => clearInterval(timer);
  }, [reload]);
  async function act(body: Record<string, unknown>) {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/admin/club/${event.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, revision: event.revision }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (result.path) {
        const url = new URL(base);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('請填寫 http 或 https 網址');
        const full = url.origin + result.path;
        setLink(full); setPair(String(body.pair));
        setQr(await QRCode.toDataURL(full, { width: 280, margin: 2, errorCorrectionLevel: 'M' }));
      }
      setNotice('已儲存。');
      await reload();
    } catch (e) { setError((e as Error).message); await reload().catch(() => {}); }
    finally { setBusy(false); }
  }
  const round = event.currentRound ?? 0;
  const assignments = event.assignments.filter(a => a.round === round);
  const finalized = event.club?.finalized.includes(round);
  return <div className="club-admin">
    <h4>雙人賽俱樂部模式</h4>
    <p>一對搭檔共用一個連結，可在多台手機開啟。每圈由雙方各自確認；裁判結算後才對觀眾發布成績與可公開牌型。</p>
    {error && <div className="alert error" role="alert">{error}</div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    <button className="button subtle" disabled={busy} onClick={() => {
      if (event.club?.enabled && !window.confirm('停用後，觀眾將可看到所有已收成績。確定停用？')) return;
      void act({ action: 'enable', enabled: !event.club?.enabled });
    }}>{event.club?.enabled ? '停用俱樂部模式' : '啟用俱樂部模式'}</button>
    <h4>搭檔專屬連結</h4>
    <label className="field">手機可連線的網站網址<input type="url" value={base} onChange={e => setBase(e.target.value)} placeholder="https://…" /></label>
    <p className="footnote">本機 localhost／127.0.0.1 無法供其他手機連線，請填入已部署網址或區域網路網址。重新簽發會讓舊連結失效，已確認狀態仍保留。</p>
    <div className="club-pair-links">{event.participants.map(p => <div key={p.id}><span>{p.id.toUpperCase()} {p.name}</span><button className="button subtle" disabled={busy || !event.club?.enabled} onClick={() => {
      if (event.club?.tokens[p.id] && !window.confirm(`重新簽發 ${p.id.toUpperCase()} 的連結並使舊連結失效？`)) return;
      try { const url = new URL(base); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); }
      catch { setError('請填寫有效的 http／https 網址'); return; }
      void act({ action: 'issue', pair: p.id });
    }}>{event.club?.tokens[p.id] ? '重新簽發' : '產生 QR／連結'}</button></div>)}</div>
    {link && <section className="club-link-card"><strong>{pair.toUpperCase()} 專屬收分卡</strong>{qr && <img src={qr} width={280} height={280} alt={`${pair} 收分 QR code`} />}<a href={link} target="_blank" rel="noopener noreferrer">開啟收分卡</a><input aria-label="專屬連結" readOnly value={link} onFocus={e => e.currentTarget.select()} /><button className="button subtle" onClick={() => { void navigator.clipboard.writeText(link).then(() => setNotice('連結已複製。')).catch(() => setError('請選取上方連結手動複製')); }}>複製連結</button><small>連結僅在本次簽發時顯示，請交給對應搭檔。</small></section>}
    <h4>目前第 {round} 圈 · {finalized ? '已結算' : '未結算'}</h4>
    <p>請在「圈次進度」指定當前圈數與開始／休息狀態。</p>
    {assignments.map(a => <div key={a.id} className="club-progress-row">桌 {a.table} · {a.boards.filter(b => event.results[`${a.id}:${b}`]).length} / {a.boards.length} 副 · {[a.ns, a.ew].map(p => `${p.toUpperCase()} ${event.club?.confirmations[round + ':' + p] ? '已確認' : '未確認'}`).join(' ／ ')}</div>)}
    <label className="field">結算原因<input value={reason} minLength={2} maxLength={200} onChange={e => setReason(e.target.value)} /></label>
    <div className="button-row"><button className="button primary" disabled={busy || !event.club?.enabled || !round || finalized || reason.trim().length < 2} onClick={() => void act({ action: 'finalize', round, force: false, reason })}>結算並發布本圈</button>
      <button className="button subtle" disabled={busy || !event.club?.enabled || !round || finalized || reason.trim().length < 2} onClick={() => {
        if (window.confirm('將強制確認尚未確認的搭檔，並取消本圈所有缺分牌。確定結算並發布？')) void act({ action: 'finalize', round, force: true, reason });
      }}>強制結算</button></div>
  </div>;
}
