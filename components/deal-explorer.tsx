'use client';
import { useEffect, useRef, useState } from 'react';
import { Board, Result, Seat, seats } from '@/lib/model';
import { legalCards, nextSeat, playCard, PlayState, ranks, strains, toPbn } from '@/lib/play';
const symbols: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣', NT: 'NT' };
type Future = { cards: number; suit: number[]; rank: number[]; equals: number[]; score: number[] };
export function DealExplorer({ board, result }: { board: Board; result?: Result }) {
  const [table, setTable] = useState<number[][] | null>(null);
  const [strain, setStrain] = useState<string>('NT');
  const [declarer, setDeclarer] = useState<Seat>('N');
  const [history, setHistory] = useState<PlayState[]>([]);
  const [future, setFuture] = useState<Future | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const worker = useRef<Worker | null>(null);
  const request = useRef(0);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(new Map<number, (value: unknown) => void>());
  function send(type: string, payload: object, accept: (value: unknown) => void) {
    const id = ++request.current;
    pending.current.set(id, accept);
    worker.current?.postMessage({ id, type, ...payload });
  }
  useEffect(() => {
    const w = new Worker('/dds-worker.js', { type: 'module' });
    worker.current = w;
    w.onmessage = ({ data }) => {
      if (data.error) {
        setError(data.error);
        setBusy(false);
      } else pending.current.get(data.id)?.(data.result);
      pending.current.delete(data.id);
    };
    w.onerror = () => {
      setError('無法載入分析引擎；可重開此副重試。');
      setBusy(false);
    };
    setBusy(true);
    send('table', { cards: toPbn(board.deal) }, (value) => {
      setTable(value as number[][]);
      setBusy(false);
    });
    timeout.current = setTimeout(() => {
      setError('分析超過 60 秒，已停止；請重開此副重試。');
      setBusy(false);
      w.terminate();
    }, 60000);
    return () => {
      w.terminate();
      pending.current.clear();
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, [board.number, toPbn(board.deal)]);
  useEffect(() => {
    if (table && timeout.current) clearTimeout(timeout.current);
  }, [table]);
  // A traveler selection highlights the recorded lead but does not play it automatically.
  useEffect(() => {
    setHistory([]);
    setFuture(null);
    if (result && result.status !== 'cancelled' && result.level) {
      setStrain(result.strain);
      setDeclarer(result.declarer);
    }
  }, [result?.assignmentId, result?.updatedAt, result?.status]);
  const state = history.at(-1);
  useEffect(() => {
    setFuture(null);
    if (!state || state.ns + state.ew === 13) {
      setBusy(!table);
      return;
    }
    let alive = true;
    setBusy(true);
    send(
      'solve',
      {
        deal: {
          trump: strains.indexOf(strain as (typeof strains)[number]),
          first: seats.indexOf(state.leader),
          currentTrickSuit: state.trick.map((p) =>
            strains.indexOf(p.card[0] as (typeof strains)[number]),
          ),
          currentTrickRank: state.trick.map((p) => ranks.indexOf(p.card[1]) + 2),
          remainCards: toPbn(state.hands),
        },
      },
      (value) => {
        if (alive) {
          setFuture(value as Future);
          setBusy(false);
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [state, strain]);
  function start(s = strain, d = declarer) {
    setStrain(s);
    setDeclarer(d);
    setError('');
    setHistory([
      {
        hands: structuredClone(board.deal),
        trick: [],
        leader: seats[(seats.indexOf(d) + 1) % 4],
        ns: 0,
        ew: 0,
      },
    ]);
  }
  const hand = state?.hands ?? board.deal;
  const legal = state ? legalCards(state) : [];
  const lead = result?.status === 'cancelled' ? '' : result?.lead.toUpperCase().replace('10', 'T');
  const leader = result ? seats[(seats.indexOf(result.declarer) + 1) % 4] : undefined;
  const validLead = !!(lead && leader && board.deal[leader].includes(lead));
  const values: Record<string, number> = {};
  if (state && future)
    for (let i = 0; i < future.cards; i++) {
      const sameSide =
        (nextSeat(state) === 'N' || nextSeat(state) === 'S') ===
        (declarer === 'N' || declarer === 'S');
      const remaining = 13 - state.ns - state.ew;
      const won = declarer === 'N' || declarer === 'S' ? state.ns : state.ew;
      const score = won + (sameSide ? future.score[i] : remaining - future.score[i]);
      values[strains[future.suit[i]] + ranks[future.rank[i] - 2]] = score;
      for (let rank = 2; rank <= 14; rank++)
        if (future.equals[i] & (1 << rank))
          values[strains[future.suit[i]] + ranks[rank - 2]] = score;
    }
  return (
    <div className="deal-explorer">
      <div className="deal-diagram">
        {(['N', 'W', 'E', 'S'] as Seat[]).map((seat) => (
          <div className={`hand hand-${seat}`} key={seat}>
            <div className="seat-label">
              {seat} {state && nextSeat(state) === seat && '← 輪到出牌'}
            </div>
            {strains.slice(0, 4).map((s) => (
              <div className="suit-line" key={s}>
                <b className={s === 'H' || s === 'D' ? 'red' : ''}>{symbols[s]}</b>
                <span>
                  {hand[seat]
                    .filter((c) => c[0] === s)
                    .sort((a, b) => ranks.indexOf(b[1]) - ranks.indexOf(a[1]))
                    .map((card) => (
                      <button
                        type="button"
                        key={card}
                        className={`playing-card ${validLead && card === lead && seat === leader ? 'opening-lead' : ''}`}
                        aria-label={`${seat} ${card}${values[card] !== undefined ? `，莊家 ${values[card]} 墩` : ''}${card === lead && seat === leader ? ' 首攻' : ''}`}
                        disabled={
                          !state || nextSeat(state) !== seat || !legal.includes(card) || busy
                        }
                        onClick={() =>
                          state && setHistory([...history, playCard(state, card, strain)])
                        }
                      >
                        {card[1]}
                        {values[card] !== undefined && <small>{values[card]}</small>}
                      </button>
                    ))}
                  {!hand[seat].some((c) => c[0] === s) && '—'}
                </span>
              </div>
            ))}
          </div>
        ))}
        <div className="deal-center">
          <span>BOARD {board.number}</span>
          <strong>{state ? `${state.ns} : ${state.ew}` : symbols[strain]}</strong>
          <small>{state ? 'NS : EW 已得墩' : `${declarer} 莊家`}</small>
        </div>
      </div>
      {lead && (
        <p className={validLead ? 'lead-note' : 'error-text'}>
          {validLead
            ? `已標示首攻 ${leader} ${symbols[lead[0]]}${lead.slice(1)}`
            : `首攻 ${lead} 不在應首攻者手中，請核對紀錄。`}
        </p>
      )}
      {state && (
        <div className="trick-strip">
          本墩：
          {state.trick.map((p) => `${p.seat} ${symbols[p.card[0]]}${p.card[1]}`).join(' → ') ||
            '等待首張'}
          {state.ns + state.ew === 13 && ' · 打牌完成'}
        </div>
      )}
      <div className="button-row">
        <label>
          莊家{' '}
          <select
            aria-label="分析莊家"
            value={declarer}
            onChange={(e) => {
              setDeclarer(e.target.value as Seat);
              setHistory([]);
            }}
          >
            {seats.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          王牌{' '}
          <select
            aria-label="分析王牌"
            value={strain}
            onChange={(e) => {
              setStrain(e.target.value);
              setHistory([]);
            }}
          >
            {strains.map((s) => (
              <option key={s} value={s}>
                {symbols[s]}
              </option>
            ))}
          </select>
        </label>
        <button className="button subtle" onClick={() => start()} disabled={!table || !!error}>
          開始／重設試打
        </button>
        <button
          className="button subtle"
          disabled={history.length < 2}
          onClick={() => setHistory(history.slice(0, -1))}
        >
          上一步
        </button>
      </div>
      <h4>Double dummy · 最佳攻防可得墩數</h4>
      {table && (
        <table className="dd-table">
          <thead>
            <tr>
              <th>莊家</th>
              {strains.map((s) => (
                <th key={s}>{symbols[s]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {seats.map((s, i) => (
              <tr key={s}>
                <th>{s}</th>
                {strains.map((t, j) => (
                  <td key={t}>
                    <button
                      title={`以 ${s} 莊家 ${symbols[t]} 開始試打`}
                      onClick={() => start(t, s)}
                    >
                      {table[j][i]}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {busy && <p role="status">正在分析…</p>}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <p className="footnote">
        點分析表格開始試打，再點手牌；牌下數字是最佳攻防下莊家最終可得墩數。分析只在此裝置執行，不會修改比賽成績。
      </p>
    </div>
  );
}
