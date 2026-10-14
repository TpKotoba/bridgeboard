'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Undo2, X } from 'lucide-react';
import type { Board, Result, Seat } from '@/lib/model';
import { seats } from '@/lib/model';
import { fullParContracts, highestParContract, highCardPoints, lawOfTotalTricks } from '@/lib/deal-analysis';
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
  rewindToCard,
} from '@/lib/play';

const symbols: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣', NT: 'NT' };
const seatNames: Record<Seat, string> = { N: '北', E: '東', S: '南', W: '西' };
const ddStrains = ['C', 'D', 'H', 'S', 'NT'] as const;
const ddSeats: Seat[] = ['N', 'S', 'E', 'W'];

export function BoardInformation({
  number,
  averageScore,
  scoreSide,
  validResults,
  navigation,
}: {
  number: number;
  averageScore: number | null;
  scoreSide: string;
  validResults: number;
  navigation?: React.ReactNode;
}) {
  const datumId = useId();
  return (
    <section className="analysis-corner board-information" aria-label="牌號與成績資訊">
      <span className="corner-kicker">BOARD NUMBER</span>
      {navigation ?? <strong className="board-number">{number}</strong>}
      <button type="button" className="board-average" popoverTarget={datumId}
        onClick={(event) => {
          const trigger = event.currentTarget;
          requestAnimationFrame(() => {
            const popup = document.getElementById(datumId);
            if (!popup?.matches(':popover-open')) return;
            const anchor = trigger.getBoundingClientRect();
            const box = popup.getBoundingClientRect();
            popup.style.left = `${Math.max(8, Math.min(anchor.left + anchor.width / 2 - box.width / 2, window.innerWidth - box.width - 8))}px`;
            popup.style.top = `${anchor.bottom + box.height + 8 <= window.innerHeight ? anchor.bottom + 6 : Math.max(8, anchor.top - box.height - 6)}px`;
          });
        }}>
        <span>Datum {scoreSide}</span>
        <br />
        <span className="corner-score-value">{averageScore === null ? '—' : `${averageScore >= 0 ? '+' : ''}${averageScore.toFixed(2)}`}</span>
      </button>
      <div id={datumId} popover="auto" className="player-detail-popover">
        {validResults} 桌有效結果
      </div>
    </section>
  );
}
type Future = { cards: number; suit: number[]; rank: number[]; equals: number[]; score: number[] };
type Analysis = { tricks: number[][]; par: { score: number; contracts: string[] } };

export function DealExplorer({
  board,
  result,
  playerNames = {},
  resultSelection = 0,
  onManualTrial,
  tableSelected = false,
  navigation,
  averageScore = null,
  scoreSide = 'NS',
  validResults = 0,
}: {
  board: Board;
  result?: Result;
  playerNames?: Partial<Record<Seat, string>>;
  resultSelection?: number;
  onManualTrial?: () => void;
  tableSelected?: boolean;
  navigation?: React.ReactNode;
  averageScore?: number | null;
  scoreSide?: string;
  validResults?: number;
}) {
  const scoreDetailId = useId();
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
        : `${result.level}${symbols[result.strain]}${result.doubled === 2 ? 'x' : result.doubled === 4 ? 'xx' : ''}.${result.declarer}`;
  const contractDelta = result && result.level > 0 ? result.tricks - result.level - 6 : null;
  const parParts = analysis ? highestParContract(analysis.par.contracts, board.dealer).replace(/NT/g, "N").split("/") : [];
  const displayedContract = tableSelected ? actualContract.replace(/NT/g, "N") : parParts[0];
  const contractParts = displayedContract?.match(/^([1-7])([♣♦♥♠N])(x{0,2})\.([NESW])$/);
  const displayedOutcome = tableSelected
    ? (result?.status !== "cancelled" && contractDelta !== null ? (contractDelta === 0 ? "=" : contractDelta > 0 ? `+${contractDelta}` : String(contractDelta)) : "")
    : (parParts[1] ?? "");
  const nsScore = tableSelected
    ? result?.status === 'cancelled'
      ? undefined
      : result?.nsScore
    : analysis?.par.score;
  const shownScore = nsScore === undefined ? undefined : nsScore * (scoreSide === "EW" ? -1 : 1);
  // Keep all four cards visible until the next trick starts, including the final trick.
  const displayedTrick = state?.trick.length ? state.trick : (state?.lastTrick ?? []);
  const rack =
    state && turn
      ? [...state.hands[turn]].sort(
          (a, b) =>
            'SHCD'.indexOf(a[0]) - 'SHCD'.indexOf(b[0]) ||
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
              {tableSelected ? 'TABLE RESULT' : 'PAR CONTRACT'}
            </span>
          </div>
          {analysis || tableSelected ? (
            <>
              <strong className="your-contract">
                {contractParts ? <>
                  <span className={['♦', '♥'].includes(contractParts[2]) ? 'contract-bid red-suit' : 'contract-bid'}>
                    {contractParts[1]}{contractParts[2]}{contractParts[3]}
                  </span>
                  <span className="contract-seat">{seatNames[contractParts[4] as Seat]}</span>
                </> : <span>{displayedContract}</span>}
                {displayedOutcome && <span className="contract-outcome">{displayedOutcome}</span>}
              </strong>
              {shownScore !== undefined && (
                <button type="button" className="contract-score" popoverTarget={scoreDetailId}
                  aria-label="查看分數、Par 與 LoTT 資訊"
                  onClick={(event) => {
                    const trigger = event.currentTarget;
                    requestAnimationFrame(() => {
                      const popup = document.getElementById(scoreDetailId);
                      if (!popup?.matches(':popover-open')) return;
                      const anchor = trigger.getBoundingClientRect();
                      const box = popup.getBoundingClientRect();
                      popup.style.left = Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8)) + 'px';
                      popup.style.top = (anchor.bottom + box.height + 8 <= window.innerHeight ? anchor.bottom + 6 : Math.max(8, anchor.top - box.height - 6)) + 'px';
                    });
                  }}>
                  <span>{scoreSide} Score</span>
                  <br />
                  <span className="corner-score-value">{shownScore >= 0 ? '+' : ''}{shownScore}</span>
                </button>
              )}
              <div id={scoreDetailId} popover="auto" className="player-detail-popover">
                {analysis && <div>Par:
                  {fullParContracts(analysis.par.contracts).map((contract, index) => (
                    <div key={index}>{contract}</div>
                  ))}
                </div>}
                {lott && <div>LoTT {lott.fit} − {lott.tricks} = {lott.difference}</div>}
                {!analysis && <div>分析計算中…</div>}
              </div>
            </>
          ) : (
            <span>計算中…</span>
          )}
        </section>
        <BoardInformation
          number={board.number}
          averageScore={averageScore}
          scoreSide={scoreSide}
          validResults={validResults}
          navigation={navigation}
        />
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
            <button
              type="button"
              key={seat}
              className={`trick-card trick-card-${seat} ${card[0] === 'H' || card[0] === 'D' ? 'red-suit' : ''}`}
              aria-label={`退回${seatNames[seat]}家出 ${symbols[card[0]]}${card[1]} 之前`}
              onClick={() => {
                const earlier = rewindToCard(history, seat, card);
                if (earlier === history) return;
                setFuture(null);
                setHistory(earlier);
              }}
            >
              <span>{symbols[card[0]]}</span>
              <b>{card[1]}</b>
            </button>
          ))}
        </div>
        <section className="analysis-corner hcp-corner" aria-label="發牌、身價與大牌點">
          <div className="hcp-metadata">
            <span>Dir: {{ N: 'North', E: 'East', S: 'South', W: 'West' }[board.dealer]}</span>
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
                onManualTrial?.();
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
