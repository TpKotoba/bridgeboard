'use client';
import { useEffect, useRef, useState } from 'react';
import { Undo2, X } from 'lucide-react';
import type { Board, Result, Seat } from '@/lib/model';
import { seats } from '@/lib/model';
import { highestParContract, highCardPoints, lawOfTotalTricks } from '@/lib/deal-analysis';
import {
  initialPlay,
  bestDeclarerTricks,
  playFromResult,
  legalCards,
  nextSeat,
  playCard,
  type PlayState,
  ranks,
  strains,
  toPbn,
} from '@/lib/play';

const symbols: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣', NT: 'NT' };
const seatNames: Record<Seat, string> = { N: '北', E: '東', S: '南', W: '西' };
const ddStrains = ['C', 'D', 'H', 'S', 'NT'] as const;
const ddSeats: Seat[] = ['N', 'S', 'E', 'W'];
type Future = { cards: number; suit: number[]; rank: number[]; equals: number[]; score: number[] };
type Analysis = { tricks: number[][]; par: { score: number; contracts: string[] } };

export function DealExplorer({
  board,
  result,
  playerNames = {},
  resultSelection = 0,
  onManualTrial,
  tableSelected = false,
}: {
  board: Board;
  result?: Result;
  playerNames?: Partial<Record<Seat, string>>;
  resultSelection?: number;
  onManualTrial?: () => void;
  tableSelected?: boolean;
}) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [selection, setSelection] = useState('');
  const [history, setHistory] = useState<PlayState[]>([]);
  const [future, setFuture] = useState<Future | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, (value: unknown) => void>());
  const request = useRef(0);
  const detachResult = useRef(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      setError('無法載入分析引擎；請重新開啟此副。');
      setBusy(false);
    };
    setBusy(true);
    send(
      'table',
      {
        cards: toPbn(board.deal),
        dealer: seats.indexOf(board.dealer),
        vulnerable: { None: 0, All: 1, NS: 2, EW: 3 }[board.vulnerability],
      },
      (value) => {
        setAnalysis(value as Analysis);
        setBusy(false);
      },
    );
    timeout.current = setTimeout(() => {
      setError('分析超過 60 秒，已停止。');
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
    if (analysis && timeout.current) clearTimeout(timeout.current);
  }, [analysis]);
  useEffect(() => {
    if (detachResult.current) {
      detachResult.current = false;
      return;
    }
    const start = playFromResult(board, result);
    setSelection(start && result ? result.declarer + result.strain : '');
    setHistory(start ? [start] : []);
    setFuture(null);
    setBusy(start ? true : !analysis);
    setError('');
  }, [
    result?.assignmentId,
    result?.updatedAt,
    result?.status,
    result?.level,
    result?.strain,
    result?.declarer,
    resultSelection,
  ]);
  const state = history.at(-1),
    declarer = (selection[0] || 'N') as Seat,
    strain = selection.slice(1) || 'NT';
  useEffect(() => {
    setFuture(null);
    if (!state || state.ns + state.ew === 13) return;
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
  function toggle(seat: Seat, trump: string) {
    // Clearing the selected row must not overwrite the manual DD choice in the result effect.
    detachResult.current = !!result;
    onManualTrial?.();
    const key = seat + trump;
    if (selection === key) {
      setSelection('');
      setHistory([]);
      setFuture(null);
      setBusy(false);
      return;
    }
    setSelection(key);
    setFuture(null);
    setError('');
    setHistory([initialPlay(board, seat)]);
  }
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
  const points = Object.fromEntries(
    seats.map((seat) => [seat, highCardPoints(board.deal[seat])]),
  ) as Record<Seat, number>;
  const lott = analysis ? lawOfTotalTricks(board, analysis.tricks) : null;
  const turn = state ? nextSeat(state) : undefined;
  const finished = state ? state.ns + state.ew === 13 : false;
  const playable = new Set(state ? legalCards(state) : []);
  function playFromHand(seat: Seat | undefined, card: string) {
    if (!state || seat !== turn || finished || busy || !future || !playable.has(card)) return;
    setFuture(null);
    setHistory([...history, playCard(state, card, strain)]);
  }
  const best = turn ? bestDeclarerTricks(Object.values(values), turn, declarer) : undefined;
  const actualContract = !result
    ? '待收分'
    : result.status === 'cancelled'
      ? 'Cancelled'
      : result.level === 0
        ? 'PASS'
        : `${result.level}${symbols[result.strain]}${result.doubled === 2 ? 'X' : result.doubled === 4 ? 'XX' : ''}.${result.declarer}`;
  const contractDelta = result && result.level > 0 ? result.tricks - result.level - 6 : null;
  const shownScore = tableSelected
    ? result?.status === 'cancelled'
      ? undefined
      : result?.nsScore
    : analysis?.par.score;
  // Keep all four cards visible until the next trick starts, including the final trick.
  const displayedTrick = state?.trick.length ? state.trick : (state?.lastTrick ?? []);
  const rack =
    state && turn
      ? [...state.hands[turn]].sort(
          (a, b) =>
            strains.indexOf(a[0] as (typeof strains)[number]) -
              strains.indexOf(b[0] as (typeof strains)[number]) ||
            ranks.indexOf(b[1]) - ranks.indexOf(a[1]),
        )
      : [];
  return (
    <div className="deal-explorer">
      <div className="compass-board">
        <section
          className="analysis-corner par-corner"
          aria-label={`第 ${board.number} 牌 Par Contract 與 LoTT`}
        >
          <div className="par-heading">
            <span className="corner-kicker">
              {tableSelected ? 'YOUR CONTRACT' : 'PAR CONTRACT'}
            </span>
          </div>
          {analysis || tableSelected ? (
            <>
              <strong className={tableSelected ? 'your-contract' : undefined}>
                {tableSelected ? actualContract : highestParContract(analysis!.par.contracts)}
                {tableSelected && result?.status !== 'cancelled' && contractDelta !== null && (
                  <span className="contract-outcome">
                    {' / '}
                    {contractDelta === 0
                      ? '='
                      : contractDelta > 0
                        ? `+${contractDelta}`
                        : contractDelta}
                  </span>
                )}
              </strong>
              {shownScore !== undefined && (
                <span>
                  {shownScore < 0 ? 'EW' : 'NS'} +{Math.abs(shownScore)}
                </span>
              )}
              {tableSelected && analysis && (
                <small className="par-reference">
                  Par: {highestParContract(analysis.par.contracts)}
                </small>
              )}
              {lott && !tableSelected && (
                <small>
                  LoTT {lott!.fit} − {lott!.tricks} = {lott!.difference}
                </small>
              )}
            </>
          ) : (
            <span>計算中…</span>
          )}
        </section>
        <div className="compass-spare" aria-hidden="true" />
        {(['N', 'W', 'E', 'S'] as Seat[]).map((seat) => (
          <section
            className={`bridge-hand bridge-hand-${seat}`}
            key={seat}
            aria-label={`${seatNames[seat]}家手牌`}
          >
            <header
              className={
                board.vulnerability === 'All' ||
                board.vulnerability === (seat === 'N' || seat === 'S' ? 'NS' : 'EW')
                  ? 'vulnerable'
                  : ''
              }
            >
              <b>{seat}</b>
              <span className="hand-player-name" title={playerNames[seat]}>
                {playerNames[seat] || `${seatNames[seat]}家`}
              </span>
            </header>
            {strains.slice(0, 4).map((suit) => {
              const cards = board.deal[seat]
                .filter((card) => card[0] === suit)
                .sort((a, b) => ranks.indexOf(b[1]) - ranks.indexOf(a[1]));
              return (
                <div className="bridge-suit" key={suit}>
                  <b className={suit === 'H' || suit === 'D' ? 'red' : ''}>{symbols[suit]}</b>
                  <span className="bridge-ranks">
                    <span
                      className="rank-string"
                      style={{ transform: `scaleX(${Math.min(1, 8 / Math.max(1, cards.length))})` }}
                    >
                      {cards.length
                        ? cards.map((card) => (
                            <button
                              key={card}
                              type="button"
                              aria-label={`${seat} ${card}，出牌`}
                              disabled={
                                seat !== turn || finished || busy || !future || !playable.has(card)
                              }
                              onClick={() => playFromHand(seat, card)}
                              className={`hand-card ${validLead && seat === leader && card === lead ? 'opening-lead' : ''}`}
                            >
                              {card[1]}
                              {seat === turn && !finished && values[card] !== undefined && (
                                <sub
                                  className={`card-dd-value ${values[card] === best ? 'dd-best' : 'dd-inferior'}`}
                                  aria-label={`莊家最終 ${values[card]} 墩，${values[card] === best ? '最佳' : '非最佳'}出牌`}
                                >
                                  {values[card]}
                                </sub>
                              )}
                            </button>
                          ))
                        : '—'}
                    </span>
                  </span>
                </div>
              );
            })}
          </section>
        ))}
        <div className="compass-center" role="group" aria-label="本墩出牌">
          {displayedTrick.map(({ seat, card }) => (
            <span
              key={seat}
              className={`trick-card trick-card-${seat} ${card[0] === 'H' || card[0] === 'D' ? 'red-suit' : ''}`}
              aria-label={`${seat} ${symbols[card[0]]}${card[1]}`}
            >
              <span>{symbols[card[0]]}</span>
              <b>{card[1]}</b>
            </span>
          ))}
        </div>
        <section className="analysis-corner hcp-corner" aria-label="發牌、身價與大牌點">
          <div className="hcp-metadata">
            <span>Dir: {board.dealer}</span>
            <span>Vul: {board.vulnerability}</span>
          </div>
          <div className="hcp-compass">
            <span>{points.N}</span>
            <span>{points.W}</span>
            <span>{points.E}</span>
            <span>{points.S}</span>
          </div>
        </section>
        <section className="analysis-corner dd-corner" aria-label="Double dummy 最佳墩數">
          {analysis && (
            <table className="compact-dd">
              <thead>
                <tr>
                  <th></th>
                  {ddStrains.map((s) => (
                    <th key={s}>{symbols[s]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ddSeats.map((seat) => (
                  <tr key={seat}>
                    <th>{seat}</th>
                    {ddStrains.map((trump) => (
                      <td key={trump}>
                        <button
                          type="button"
                          aria-label={`${seat} ${symbols[trump]} ${analysis.tricks[strains.indexOf(trump)][seats.indexOf(seat)]} 墩${selection === seat + trump ? '，試打中，點擊退出' : '，點擊試打'}`}
                          aria-pressed={selection === seat + trump}
                          onClick={() => toggle(seat, trump)}
                        >
                          {analysis.tricks[strains.indexOf(trump)][seats.indexOf(seat)]}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      {lead && !validLead && <p className="error-text">首攻 {lead} 與牌型不符，請核對紀錄。</p>}
      {state && (
        <div className="play-keyboard">
          <div className="play-keyboard-heading">
            <strong>
              {finished ? '已打完' : `${turn} ${playerNames[turn!] || seatNames[turn!]} 出牌`}
            </strong>
            <button
              type="button"
              onClick={() => {
                setFuture(null);
                setHistory(history.slice(0, -1));
              }}
              disabled={history.length < 2}
              aria-label="上一步"
              title="上一步"
            >
              <Undo2 size={16} />
            </button>
            <button
              type="button"
              onClick={() => {
                setSelection('');
                setHistory([]);
                setFuture(null);
                setBusy(false);
              }}
              aria-label="離開試打"
              title="離開試打"
            >
              <X size={16} />
            </button>
          </div>
          <div className="play-context">
            <span>
              {tableSelected && result ? actualContract : `${declarer} ${symbols[strain]}`} · NS{' '}
              {state.ns} / EW {state.ew}
            </span>
          </div>
          {!finished && (
            <div
              className="play-rack"
              aria-label={`${turn} ${playerNames[turn!] || ''} 的剩餘手牌`}
            >
              {rack.map((card) => (
                <button
                  key={`${turn}-${card}`}
                  type="button"
                  className={
                    card[0] === 'H' || card[0] === 'D' ? 'rack-card red-suit' : 'rack-card'
                  }
                  disabled={busy || !future || !playable.has(card)}
                  aria-label={`${turn} ${card}`}
                  onClick={() => playFromHand(turn, card)}
                >
                  <span>{symbols[card[0]]}</span>
                  <b>{card[1]}</b>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {busy && (
        <p role="status" className="analysis-status">
          正在計算雙夢家…
        </p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </div>
  );
}
