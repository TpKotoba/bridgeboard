'use client';
import { useEffect, useRef, useState } from 'react';
import type { ClubView } from '@/lib/club-view';
import type { ResultInput } from '@/lib/model';
import { contractScore } from '@/lib/scoring';
import { MiniContractFields } from '@/components/mini-contract-fields';

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
  useEffect(() => { if (data?.role !== 'input' || data?.locked || data?.finalized) setDraft(null); }, [data?.role, data?.locked, data?.finalized]);
  function edit(number: number) {
    if (!data?.assignment || data.role !== 'input' || data.locked) return;
    const r = data.boards.find(b => b.number === number)?.result;
    setDraft(r ? { assignmentId: r.assignmentId, board: r.board, level: r.level, strain: r.strain, doubled: r.doubled, declarer: r.declarer, tricks: r.tricks, lead: r.lead, miniBridge: data.gameMode === 'minibridge' } : {
      assignmentId: data.assignment.id, board: number, level: 1, strain: 'C', doubled: 1, declarer: 'N', tricks: 7, lead: '', miniBridge: data.gameMode === 'minibridge',
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
        body: JSON.stringify({ requestId: crypto.randomUUID(), round: confirm ? data.round : draftRound, confirm, ...(!confirm ? { result: draft } : { reviewVersion: data.reviewVersion }) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setDraft(null);
      setNotice(confirm ? '本桌本圈成績已認可，雙方均已鎖定。' : '成績已儲存。');
      await read();
    } catch (e) { setError((e as Error).message); await read().catch(() => {}); }
    finally { submitting.current = false; setBusy(false); }
  }
  const active = !!data && data.status === 'live' && !data.locked && !data.finalized && data.phase !== 'break' && data.round > 0;
  const editable = active && data?.role === 'input';
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
          <p>{data.finalized ? '本圈已結算' : data.accepted ? '本桌成績已認可。若需更正，請聯絡裁判。' : data.phase === 'break' ? '圈間休息，暫停輸入與確認' : data.role === 'input' ? '你是輸入方，請輸入全部成績，再由對方確認。' : '你是確認方，請核對全部成績；有誤請告知輸入方更正。'}</p>
          <div className="club-board-list">{data.boards.map(b => <div key={b.number} className="club-board-result">
            <strong>牌 {b.number}</strong><span>{!b.result ? '未收分' : b.result.status === 'cancelled' ? '取消' : b.result.level === 0 ? 'Pass' : `${b.result.miniBridge ? (b.result.level === 1 ? '一線 ' : '成局 ') : b.result.level}${b.result.strain}${b.result.doubled === 2 ? 'x' : b.result.doubled === 4 ? 'xx' : ''} ${b.result.declarer} · ${b.result.tricks} 墩`}</span>
            {b.result && b.result.status !== 'cancelled' && <small>NS {b.result.nsScore > 0 ? '+' : ''}{b.result.nsScore}</small>}
            {data.role === 'input' && <button className="button subtle" disabled={!editable || busy || b.result?.status === 'cancelled'} onClick={() => edit(b.number)}>{b.result ? '更正' : '輸入'}</button>}
          </div>)}</div>
          <p>輸入：{data.roles?.inputPair.toUpperCase()} ／ 確認：{data.roles?.confirmPair.toUpperCase()} · {data.accepted ? '已認可' : missing ? '待輸入完成' : '待對方確認'}</p>
        </> : <p>{data.round ? '本圈輪空，無需輸入或確認。' : '等待裁判指定目前圈數。'}</p>}
      </section>
      {draft && editable && <form className="panel club-section" onSubmit={e => { e.preventDefault(); void submit(false); }}>
        <h2>牌 {draft.board} · {data.gameMode === 'minibridge' ? 'MiniBridge · 無身價' : board?.vulnerability === 'All' ? '雙方有身價' : board?.vulnerability === 'None' ? '雙方無身價' : `${board?.vulnerability} 有身價`}</h2>
        <div className="form-grid">
          {data.gameMode === 'minibridge' ? <MiniContractFields value={draft} onChange={setDraft} /> : <>
          <label className="field">線位<select value={draft.level} onChange={e => { const level = Number(e.target.value); setDraft({ ...draft, level, tricks: level ? level + 6 : 0, doubled: 1 }); }}>{Array.from({ length: 8 }, (_, n) => <option key={n} value={n}>{n || 'Pass'}</option>)}</select></label>
          <label className="field">合約花色<select disabled={!draft.level} value={draft.strain} onChange={e => setDraft({ ...draft, strain: e.target.value as ResultInput['strain'] })}>{['C','D','H','S','NT'].map((s,i) => <option key={s} value={s}>{['♣','♦','♥','♠','NT'][i]}</option>)}</select></label>
          </>}
          <label className="field">莊家<select disabled={!draft.level} value={draft.declarer} onChange={e => setDraft({ ...draft, declarer: e.target.value as ResultInput['declarer'] })}>{['N','E','S','W'].map(s => <option key={s}>{s}</option>)}</select></label>
          {data.gameMode !== 'minibridge' && <>
          <label className="field">賭倍<select disabled={!draft.level} value={draft.doubled} onChange={e => setDraft({ ...draft, doubled: Number(e.target.value) as 1|2|4 })}><option value={1}>無</option><option value={2}>x</option><option value={4}>xx</option></select></label>
          </>}
          <label className="field">實得墩數<select disabled={!draft.level} value={draft.tricks} onChange={e => setDraft({ ...draft, tricks: Number(e.target.value) })}>{Array.from({ length: 14 }, (_, n) => <option key={n} value={n}>{n}{draft.level ? `（${n - draft.level - 6 >= 0 ? '+' : ''}${n - draft.level - 6}）` : ''}</option>)}</select></label>
          <label className="field">首引（選填，如 S2）<input maxLength={4} value={draft.lead} onChange={e => setDraft({ ...draft, lead: e.target.value.toUpperCase() })} /></label>
        </div>
        <p className="score-preview">NS Score {board ? contractScore(draft, board.vulnerability, data.gameMode === 'minibridge') : '—'}</p>
        <div className="button-row"><button className="button primary" disabled={busy}>儲存這副成績</button><button type="button" className="button subtle" onClick={() => setDraft(null)}>關閉</button></div>
      </form>}
      {data.assignment && data.role === 'confirm' && <section className="panel club-section"><h3>本圈確認</h3><p>請核對上方全部成績。確認後本桌成績獲認可，雙方均無法再修改。</p>
        {missing > 0 && <p role="status">尚缺 {missing} 副成績，等待輸入方補齊；未完成的牌請裁判處理。</p>}
        <button className="button primary" disabled={!active || busy || missing > 0} onClick={() => { if (window.confirm('已核對全部成績，確認並鎖定本桌本圈？')) void submit(true); }}>確認本桌本圈成績</button>
      </section>}
    </>}
  </main>;
}
