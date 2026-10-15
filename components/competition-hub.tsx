'use client';
import { Breadcrumbs } from './breadcrumbs';
import { SessionControl } from './session-control';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listenForOutsideDismiss } from '@/lib/outside-dismiss';
import { EventCalendar } from './event-calendar';
import { ArrowLeft, ArrowRight, CalendarDays, Eye, EyeOff, MapPin, Plus, Trophy, Users } from 'lucide-react';
import { CreateDialog, Modal } from './scoreboard';
import type { Competition } from '@/lib/competitions';

async function request<T>(url: string, body?: object, method = 'POST'): Promise<T> {
  const r = await fetch(url, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? '讀取失敗');
  return data;
}
const format = (s: Competition['stages'][number]) => (s.gameMode === 'minibridge' ? 'MiniBridge · ' : '') + (s.kind === 'teams' ? '隊制賽 · IMP / VP' : `雙人賽 · ${s.pairMethod === 'mp' ? 'MP' : s.pairMethod === 'butler' ? 'ButlerIMP' : 'CrossIMP'}`);

export default function CompetitionHub({ competitionId }: { competitionId?: string }) {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [session, setSession] = useState({ admin: false, director: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [sessionExpanded, setSessionExpanded] = useState(false);
  const account = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sessionExpanded || !account.current) return;
    return listenForOutsideDismiss(account.current, () => setSessionExpanded(false));
  }, [sessionExpanded]);
  const [creating, setCreating] = useState(false);
  const [addingStage, setAddingStage] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [date, setDate] = useState('');
  const load = useCallback(async () => {
    const [list, auth] = await Promise.all([
      request<{ competitions: Competition[] }>('/api/competitions'),
      request<{ admin: boolean; director: boolean }>('/api/session'),
    ]);
    setCompetitions(list.competitions); setSession(auth);
  }, []);
  useEffect(() => { void load().catch(e => setError(e.message)).finally(() => setLoading(false)); }, [load]);
  const competition = competitions.find(c => c.id === competitionId);
  const matches = competitions.filter(c => (!date || c.date === date) && `${c.prefix} ${c.name} ${c.venue} ${c.date}`.toLowerCase().includes(query.toLowerCase()));
  return <div className={`app-shell competition-hub${competitionId ? ' competition-home' : ''}`}>
    <aside className="sidebar">
      <a href="/" className="brand"><span className="brand-symbol" aria-hidden="true">♦</span><span><span className="sidebar-wordmark">VALET</span><small>橋牌賽事記分</small></span></a>
      <div className="sidebar-label">賽事工作區</div>
      <a href="/" className="nav-item active"><Trophy size={18} />瀏覽賽事</a>
      <div className="sidebar-bottom"><div className="sidebar-note"><span className="tiny-suits">♠ <b>♥ ♦</b> ♣</span><p>每一場比賽，從這裡開始。</p></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><Breadcrumbs items={[{ label: competition?.name ?? (competitionId ? '賽事主頁' : '瀏覽賽事') }]} />
        {session.admin ? <div ref={account} className="hub-account" onKeyDown={e => { if (e.key === 'Escape') setSessionExpanded(false); }}>
          <SessionControl director={session.director} menuLabel={session.director ? competitionId ? '刪除賽段' : '刪除比賽' : '功能表'} onMenu={() => {
            if (session.director) { setDeleting(true); setNotice(''); }
            else setSessionExpanded(!sessionExpanded);
          }} onLogout={async () => {
            try {
              const response = await fetch('/api/session', { method: 'DELETE' });
              if (!response.ok) throw new Error('登出失敗，請再試一次。');
              setSession({ admin: false, director: false }); setSessionExpanded(false); setCreating(false); setAddingStage(false); setEditing(false); setDeleting(false);
            } catch (e) { setError((e as Error).message); }
          }} />
          {sessionExpanded && <div id="hub-account-menu" className="hub-account-menu">
            {session.director && <button type="button" onClick={() => { setSessionExpanded(false); if (competition) setEditing(true); else setCreating(true); }}>{competition ? '編輯賽事資訊' : '建立賽事'}</button>}
            <p>{competition ? '選擇賽段後，可從登入身分開啟' : '進入賽事後，可從登入身分開啟'}{session.director ? '裁判後台。' : '賽務後台。'}</p>
          </div>}
        </div> : <button className="hub-session" onClick={() => setLogin(!login)}>賽事管理</button>}
      </header>
      <main>
        {notice && <div className="alert success" role="status">{notice}</div>}
        {error && <div className="alert error" role="alert">{error}<button onClick={() => { setError(''); void load().catch(e => setError(e.message)); }}>重新載入</button></div>}
        {login && !session.admin && <Modal title="裁判／賽務登入" onClose={() => { setLogin(false); setLoginError(''); setShowPassword(false); }}><form onSubmit={async e => {
          e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setLoginError('');
          try { await request('/api/session', { password: String(form.get('password')) }); await load(); setLogin(false); setShowPassword(false); }
          catch (e) { setLoginError((e as Error).message); } finally { setBusy(false); }
        }}><label className="field">密碼<span className="password-input"><input type={showPassword ? 'text' : 'password'} name="password" autoComplete="current-password" required /><button type="button" className="password-toggle" aria-label={showPassword ? '隱藏密碼' : '顯示密碼'} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>{loginError && <p className="alert error" role="alert">{loginError}</p>}<button className="button primary" disabled={busy}>{busy ? '登入中…' : '登入'}</button></form></Modal>}
        {loading ? <div className="empty">載入賽事中…</div> : competitionId && !competition ? <div className="empty"><h2>找不到賽事</h2><a href="/" className="button subtle">瀏覽其他賽事</a></div> : competition ? <>
          <section className="competition-hero">
            {competition.prefix && <p className="competition-prefix">{competition.prefix}</p>}
            <h1>{competition.name}</h1>
            <div className="competition-facts"><span><CalendarDays size={17} />{competition.date}</span><span><MapPin size={17} />{competition.venue || '地點未公布'}</span></div>
            <div className="button-row"><a className="button subtle" href="/"><ArrowLeft size={16} />瀏覽其他賽事</a>{session.director && <><button className="button subtle" onClick={() => setEditing(!editing)}>編輯賽事資訊</button><button className="button subtle" onClick={() => setAddingStage(true)}><Plus size={16} />{competition.hasStages ? '新增賽段' : '設立賽段'}</button></>}</div>
          </section>
          {editing && session.director && <form className="panel hub-form" key={competition.revision} onSubmit={async e => {
            e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError('');
            try {
              await request(`/api/events/${competition.id}`, { action: 'competition-settings', revision: competition.revision, requestId: crypto.randomUUID(), reason: '編輯賽事共用資訊', name: String(form.get('name')), prefix: String(form.get('prefix')), date: String(form.get('date')), venue: String(form.get('venue')) }, 'PATCH');
              await load(); setEditing(false);
            } catch (e) { setError((e as Error).message); await load().catch(() => {}); } finally { setBusy(false); }
          }}><h3>賽事共用資訊</h3><label className="field">名稱<input name="name" minLength={2} maxLength={80} required defaultValue={competition.name} /></label><label className="field">前綴<input name="prefix" maxLength={80} defaultValue={competition.prefix} /></label><div className="form-grid"><label className="field">日期<input name="date" type="date" required defaultValue={competition.date} /></label><label className="field">地點<input name="venue" maxLength={80} defaultValue={competition.venue} /></label></div><button className="button primary" disabled={busy}>儲存共用資訊</button></form>}
          <section aria-label={competition.hasStages ? '選擇賽段' : '賽事成績'}>
            <div className="hub-section-heading"><h2>{competition.hasStages ? '選擇賽段' : '賽事成績'}</h2>{competition.hasStages && <p>各賽段的名單、賽制與成績各自獨立。</p>}</div>
            <div className="competition-grid competition-list">{competition.stages.map(s => <a key={s.id} className="panel competition-card competition-card-compact" href={`/?event=${encodeURIComponent(s.id)}&view=standings`}>
              <span className={`event-icon ${s.kind}`} aria-hidden="true"><Users size={23} /></span>
              <div className="competition-card-copy"><h3>{competition.hasStages ? s.name : '進入賽事'}</h3><p>{format(s)}</p><p>{s.participants} {s.kind === 'pairs' ? '對搭檔' : '隊'} · {s.rounds} 圈 · {s.boards} 副牌</p></div>
              <span className="competition-status">{s.status === 'finished' ? '已結束' : '進行中'}</span>
            </a>)}</div>
          </section>
        </> : <>
          <div className="page-heading"><div><h1>即時掌握你的表現</h1><p>還在用過時的 Excel 試算表舉辦比賽嗎？</p></div>{session.director && <button className="button primary" onClick={() => setCreating(true)}><Plus size={16} />建立賽事</button>}</div>
          <div className="hub-search">
            <label className="field" htmlFor="competition-search">搜尋賽事</label>
            <div className="field hub-search-input">
              <input id="competition-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="名稱、地點或日期" />
              <EventCalendar dates={competitions.map(c => c.date)} value={date} onChange={setDate} />
            </div>
            {date && <div className="hub-date-filter"><span>日期：{date}</span><button type="button" className="button subtle" onClick={() => setDate('')}>清除日期</button></div>}
          </div>
          <div className="competition-grid competition-list">{matches.map(c => <a key={c.id} className="panel competition-card competition-card-compact" href={`/?competition=${encodeURIComponent(c.id)}`}>
            <span className={`event-icon ${c.stages[0].kind}`} aria-hidden="true"><Users size={23} /></span>
            <div className="competition-card-copy"><h2>{[c.prefix, c.name].filter(Boolean).join(' ')}</h2><p><span>{c.hasStages ? `${c.stages.length} 個賽段` : format(c.stages[0])}</span><time dateTime={c.date}>{Number(c.date.slice(5, 7))} / {Number(c.date.slice(8, 10))}</time></p></div>
            <span className="competition-status">{c.stages.every(s => s.status === 'finished') ? '已結束' : '進行中'}</span>
          </a>)}</div>
          {!competitions.length && <div className="empty">尚未建立賽事，請裁判登入後建立。</div>}
          {!!competitions.length && !matches.length && <div className="empty">沒有符合的賽事。</div>}
        </>}
      </main>
    </div>
    {creating && <CreateDialog onClose={() => setCreating(false)} onCreated={async id => { location.assign(`/?competition=${encodeURIComponent(id)}`); }} />}
    {addingStage && competition && <CreateDialog competition={competition} onClose={() => { setAddingStage(false); void load().catch(e => setError(e.message)); }} onCreated={async () => { await load(); setAddingStage(false); }} />}
    {deleting && session.director && competition && <DeleteStagesDialog competition={competition} onClose={() => setDeleting(false)} onDeleted={async rootDeleted => { setDeleting(false); if (rootDeleted) location.assign('/'); else { setNotice('已刪除賽段。'); await load(); } }} />}
    {deleting && session.director && !competitionId && <DeleteCompetitionsDialog competitions={competitions} onClose={() => setDeleting(false)} onRefresh={load} onDeleted={async count => {
      setDeleting(false); setNotice(`已刪除 ${count} 場比賽。`); await load();
    }} />}
  </div>;
}

function DeleteStagesDialog({ competition, onClose, onDeleted }: {
  competition: Competition;
  onClose: () => void;
  onDeleted: (rootDeleted: boolean) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Competition['stages'][number] | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    if (!selected || busy || confirmation !== selected.name) return;
    setBusy(true); setError('');
    try {
      await request(`/api/admin/events/${encodeURIComponent(selected.id)}`, { confirmStageName: confirmation, revision: selected.revision }, 'DELETE');
      await onDeleted(selected.id === competition.id);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <Modal title={selected ? '確認刪除賽段' : '刪除賽段'} onClose={() => { if (!busy) onClose(); }}>
    {error && <p className="alert error" role="alert">{error}</p>}
    {selected ? <>
      <p>確定刪除「{selected.name}」？此賽段的名單與成績將一併刪除，無法復原。</p>
      {selected.id === competition.id && <p>這是此賽事最後一個賽段，刪除後也會移除賽事。</p>}
      <label className="field">請輸入賽段名稱「{selected.name}」<input value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" disabled={busy} /></label>
      <div className="button-row"><button type="button" className="button subtle" disabled={busy} onClick={() => setSelected(null)}>返回選擇</button><button type="button" className="button danger" disabled={busy || confirmation !== selected.name} onClick={() => void remove()}>{busy ? '刪除中…' : '確認刪除賽段'}</button></div>
    </> : <>
      <p>選擇要刪除的賽段。</p>
      <div className="delete-competition-list">{competition.stages.map(stage => <button type="button" key={stage.id} className="button subtle" disabled={stage.id === competition.id && competition.stages.length > 1} onClick={() => { setConfirmation(''); setSelected(stage); }}>{stage.name}</button>)}</div>
      {competition.stages.length > 1 && <p className="footnote">第一賽段包含賽事共用資料，須先刪除其他賽段才能刪除。</p>}
    </>}
  </Modal>;
}

function DeleteCompetitionsDialog({ competitions, onClose, onRefresh, onDeleted }: {
  competitions: Competition[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onDeleted: (count: number) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmations, setConfirmations] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const visible = competitions.filter(c => `${c.prefix} ${c.name} ${c.date}`.toLowerCase().includes(query.toLowerCase()));
  const chosen = competitions.filter(c => selected.includes(c.id));
  const namesMatch = chosen.every(c => confirmations[c.id] === c.name);
  async function remove() {
    if (busy || !chosen.length || !namesMatch) return;
    setBusy(true); setError('');
    try {
      const result = await request<{ deleted: number }>('/api/admin/competitions', {
        competitions: chosen.map(c => ({ id: c.id, confirmName: confirmations[c.id], stages: c.stages.map(s => ({ id: s.id, revision: s.revision })) })),
      }, 'DELETE');
      await onDeleted(result.deleted);
    } catch (e) {
      setError((e as Error).message); setConfirming(false); setSelected([]); setConfirmations({});
      await onRefresh().catch(() => {});
    } finally { setBusy(false); }
  }
  return <Modal title={confirming ? '確認刪除比賽' : '刪除比賽'} onClose={() => { if (!busy) onClose(); }}>
    <p>刪除比賽會一併刪除其所有賽段、名單與成績，無法復原。</p>
    {error && <p className="alert error" role="alert">{error}</p>}
    {!confirming && <>
      <label className="field">搜尋比賽<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="名稱或日期" /></label>
      <div className="button-row"><button type="button" className="button subtle" disabled={!visible.length} onClick={() => setSelected(previous => [...new Set([...previous, ...visible.map(c => c.id)])])}>全選搜尋結果</button><button type="button" className="button subtle" disabled={!selected.length} onClick={() => setSelected([])}>清除勾選</button></div>
    </>}
    <div className="delete-competition-list">
      {(confirming ? chosen : visible).map(c => <label className="delete-competition-option" key={c.id}>
        {!confirming && <input type="checkbox" checked={selected.includes(c.id)} onChange={e => setSelected(previous => e.target.checked ? [...previous, c.id] : previous.filter(id => id !== c.id))} />}
        <span><strong>{[c.prefix, c.name].filter(Boolean).join(' ')}</strong><small>{c.date} · {c.stages.length} 個賽段</small>{confirming && <><small>請輸入比賽名稱「{c.name}」</small><input aria-label={`確認比賽名稱：${c.name}`} value={confirmations[c.id] ?? ''} onChange={e => setConfirmations(previous => ({ ...previous, [c.id]: e.target.value }))} autoComplete="off" disabled={busy} /></>}</span>
      </label>)}
      {!visible.length && !confirming && <p>沒有符合的比賽。</p>}
    </div>
    <div className="button-row">
      <button type="button" className="button subtle" disabled={busy} onClick={() => confirming ? setConfirming(false) : onClose()}>{confirming ? '返回勾選' : '取消'}</button>
      <button type="button" className="button danger" disabled={busy || !chosen.length || (confirming && !namesMatch)} onClick={() => confirming ? void remove() : (setConfirmations({}), setConfirming(true))}>{busy ? '刪除中…' : confirming ? `確認刪除 ${chosen.length} 場` : `刪除所選 ${chosen.length} 場`}</button>
    </div>
  </Modal>;
}
