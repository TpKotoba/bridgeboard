'use client';
import { useEffect, useRef, useState } from 'react';
import type { ClubView } from '@/lib/club-view';
import type { ResultInput } from '@/lib/model';
import { contractScore } from '@/lib/scoring';

export default function ClubPage() {
  const [data, setData] = useState<ClubView | null>(null);
  const [draft, setDraft] = useState<ResultInput | null>(null);
  const [draftRound, setDraftRound] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const context = useRef({ id: '', token: '' });
  const submitting = useRef(false);
  async function read() {
    const { id, token } = context.current;
    const response = await fetch(`/api/club/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    setData(body);
    return body as ClubView;
  }
  useEffect(() => {
    context.current = { id: new URLSearchParams(location.search).get('event') ?? '', token: location.hash.slice(1) };
    void read().catch(e => setError(e.message));
    const timer = setInterval(() => { void read().catch(e => setError(e.message)); }, 10000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { if (data && draftRound !== data.round) setDraft(null); }, [data?.round, draftRound]);
  function edit(number: number) {
    if (!data?.assignment) return;
    const r = data.boards.find(b => b.number === number)?.result;
    setDraft(r ? { assignmentId: r.assignmentId, board: r.board, level: r.level, strain: r.strain, doubled: r.doubled, declarer: r.declarer, tricks: r.tricks, lead: r.lead } : {
      assignmentId: data.assignment.id, board: number, level: 1, strain: 'C', doubled: 1, declarer: 'N', tricks: 7, lead: '',
    });
    setDraftRound(data.round);
    setNotice('');
  }
  async function submit(confirm: boolean) {
    if (!data || submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/club/${encodeURIComponent(context.current.id)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${context.current.token}` },
        body: JSON.stringify({ requestId: crypto.randomUUID(), round: confirm ? data.round : draftRound, confirm, ...(!confirm ? { result: draft } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setDraft(null);
      setNotice(confirm ? '本圈已確認，本搭檔的輸入已鎖定。' : '成績已儲存。');
      await read();
    } catch (e) { setError((e as Error).message); await read().catch(() => {}); }
    finally { submitting.current = false; setBusy(false); }
  }
  const editable = !!data && data.status === 'live' && !data.locked && !data.finalized && data.phase !== 'break' && data.round > 0;
  const board = data?.boards.find(b => b.number === draft?.board);
  const missing = data?.boards.filter(b => !b.result).length ?? 0;
  return <main className="club-page">
    <header><span className="eyebrow">CLUB SCORECARD</span><h1>{data?.pairName ?? '搭檔收分'}</h1><p>{data?.name}</p></header>
    {error && <div className="alert error" role="alert">{error}</div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    {!data ? <p>正在讀取專屬收分卡…</p> : <>
      <section className="panel club-section">
        <h2>{data.pair.toUpperCase()} · {data.round ? `第 ${data.round} 圈` : '尚未開始'}</h2>
        {data.assignment ? <><p>桌 {data.assignment.table} · NS {data.names?.ns} ／ EW {data.names?.ew}</p>
          <p>{data.finalized ? '本圈已結算' : data.locked ? '你已確認；對方更正的最新結果仍會同步顯示。' : data.phase === 'break' ? '圈間休息，暫停輸入' : '確認前可更正，最後成功提交的成績為準。'}</p>
          <div className="club-board-list">{data.boards.map(b => <button key={b.number} className="button subtle" disabled={!editable || busy || b.result?.status === 'cancelled'} onClick={() => edit(b.number)}>
            <strong>牌 {b.number}</strong><span>{!b.result ? '未收分' : b.result.status === 'cancelled' ? '取消' : b.result.level === 0 ? 'Pass' : `${b.result.level}${b.result.strain}${b.result.doubled === 2 ? 'x' : b.result.doubled === 4 ? 'xx' : ''} ${b.result.declarer} · ${b.result.tricks} 墩`}</span>
            {b.result && b.result.status !== 'cancelled' && <small>NS {b.result.nsScore > 0 ? '+' : ''}{b.result.nsScore}</small>}
          </button>)}</div>
          <p>{data.confirmations.map(c => `${c.pair.toUpperCase()} ${c.confirmed ? '已確認' : '未確認'}`).join(' ／ ')}</p>
        </> : <p>{data.round ? '本圈輪空，無需輸入或確認。' : '等待裁判指定目前圈數。'}</p>}
      </section>
      {draft && editable && <form className="panel club-section" onSubmit={e => { e.preventDefault(); void submit(false); }}>
        <h2>牌 {draft.board} · {board?.vulnerability === 'All' ? '雙方有身價' : board?.vulnerability === 'None' ? '雙方無身價' : `${board?.vulnerability} 有身價`}</h2>
        <div className="form-grid">
          <label className="field">線位<select value={draft.level} onChange={e => { const level = Number(e.target.value); setDraft({ ...draft, level, tricks: level ? level + 6 : 0, doubled: 1 }); }}>{Array.from({ length: 8 }, (_, n) => <option key={n} value={n}>{n || 'Pass'}</option>)}</select></label>
          <label className="field">合約花色<select disabled={!draft.level} value={draft.strain} onChange={e => setDraft({ ...draft, strain: e.target.value as ResultInput['strain'] })}>{['C','D','H','S','NT'].map((s,i) => <option key={s} value={s}>{['♣','♦','♥','♠','NT'][i]}</option>)}</select></label>
          <label className="field">莊家<select disabled={!draft.level} value={draft.declarer} onChange={e => setDraft({ ...draft, declarer: e.target.value as ResultInput['declarer'] })}>{['N','E','S','W'].map(s => <option key={s}>{s}</option>)}</select></label>
          <label className="field">賭倍<select disabled={!draft.level} value={draft.doubled} onChange={e => setDraft({ ...draft, doubled: Number(e.target.value) as 1|2|4 })}><option value={1}>無</option><option value={2}>x</option><option value={4}>xx</option></select></label>
          <label className="field">實得墩數<select disabled={!draft.level} value={draft.tricks} onChange={e => setDraft({ ...draft, tricks: Number(e.target.value) })}>{Array.from({ length: 14 }, (_, n) => <option key={n} value={n}>{n}{draft.level ? `（${n - draft.level - 6 >= 0 ? '+' : ''}${n - draft.level - 6}）` : ''}</option>)}</select></label>
          <label className="field">首引（選填，如 S2）<input maxLength={4} value={draft.lead} onChange={e => setDraft({ ...draft, lead: e.target.value.toUpperCase() })} /></label>
        </div>
        <p className="score-preview">NS Score {board ? contractScore(draft, board.vulnerability) : '—'}</p>
        <div className="button-row"><button className="button primary" disabled={busy}>儲存這副成績</button><button type="button" className="button subtle" onClick={() => setDraft(null)}>關閉</button></div>
      </form>}
      {data.assignment && <section className="panel club-section"><h3>本圈確認</h3><p>確認後，本搭檔所有裝置均無法再輸入本圈。對方仍可更正，必要時請聯絡裁判。</p>
        {missing > 0 && <p role="status">尚缺 {missing} 副成績，請先補齊；未完成的牌請裁判處理。</p>}
        <button className="button primary" disabled={!editable || busy || missing > 0 || !!draft} onClick={() => { if (window.confirm('確認本圈成績並鎖定本搭檔的提交權？')) void submit(true); }}>確認本圈並鎖定</button>
        {draft && <p>請先儲存或關閉正在編輯的成績。</p>}
      </section>}
    </>}
  </main>;
}
