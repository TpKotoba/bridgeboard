'use client';
import { Breadcrumbs } from './breadcrumbs';
import { SplitContractEditor } from './split-contract-editor';
import { MiniContractFields } from './mini-contract-fields';
import { participantNumber } from '@/lib/participant-number';
import { EventCalendar } from './event-calendar';
import { Info } from 'lucide-react';
import { SessionControl } from './session-control';
import { ClubAdmin } from './club-admin';
import { useCallback, useEffect, useRef, useState } from 'react';
import { boardGroups, boardRange } from '@/lib/board-groups';
import { allRoundsComplete, roundProgress } from '@/lib/round-progress';
import { handviewerUrl } from '@/lib/handviewer';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Eye,
  EyeOff,
  Flag,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Search,
  Settings2,
  Spade,
  Star,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import type {
  Assignment,
  Audit,
  Board,
  BridgeEvent,
  Kind,
  Mutation,
  PublicEvent,
  Result,
  ResultInput,
  Seat,
} from '@/lib/model';
import { resultKey } from '@/lib/model';
import { BoardInformation, DealExplorer } from './deal-explorer';
import { tableNames } from '@/lib/table-names';
import { boardRounds as getBoardRounds } from '@/lib/board-navigation';
import { awardedResult, teamBoardImps, contractScore, imps, teamStandingsThroughRound, vp } from '@/lib/scoring';
import {
  exportMovement,
  exportPbn,
  exportResultsCsv,
  parseMovement,
  parsePbn,
  parseResultsCsv,
} from '@/lib/imports';
type EventSummary = {
  id: string;
  name: string;
  prefix?: string;
  updatedAt?: string;
  kind: Kind;
  pairMethod?: 'mp' | 'crossimp' | 'butler';
  date: string;
  venue: string;
  status: string;
  demo: boolean;
  participants: number;
  rounds: number;
  boards: number;
  received: number;
  expected: number;
};
type Tab = 'standings' | 'rounds' | 'boards' | 'players' | 'admin';
type AdminEvent = PublicEvent & { audit?: Audit[]; canDirect?: boolean };
const methodNames = { mp: 'MP', crossimp: 'CrossIMP', butler: 'ButlerIMP' };
function pairValue(value: number | null | undefined, top: number, method = 'mp') {
  return value == null
    ? '—'
    : method === 'mp'
      ? `${number(top ? (value / top) * 100 : null)}%`
      : `${value >= 0 ? '+' : ''}${number(value, method === 'butler' ? 0 : 2)}`;
}
const suitSymbols: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣', NT: 'NT' };
function pairTone(value: number | null | undefined, top: number, method: string) {
  if (value == null || (method === 'mp' && top <= 0)) return 'score-neutral';
  const score = method === 'mp' ? (value / top) * 100 : value;
  return score < (method === 'mp' ? 40 : -2)
    ? 'score-low'
    : score > (method === 'mp' ? 60 : 2)
      ? 'score-high'
      : 'score-neutral';
}
const seatNames: Record<Seat, string> = { N: '北', E: '東', S: '南', W: '西' };
const vulNames: Record<string, string> = {
  None: '雙方無身價',
  NS: '南北有身價',
  EW: '東西有身價',
  All: '雙方有身價',
};
function hasDeal(b: PublicEvent['boards'][number]): b is Board {
  return 'deal' in b;
}
function number(n: number | null, places = 2) {
  return n === null ? '—' : n.toFixed(places);
}
function taipeiDateInput(value?: string) {
  return value
    ? new Date(value)
        .toLocaleString('sv-SE', { timeZone: 'Asia/Taipei', hour12: false })
        .slice(0, 16)
        .replace(' ', 'T')
    : '';
}
function signed(n: number) {
  return n > 0 ? `+${n}` : String(n);
}
function displayContract(r: ResultInput) {
  if (r.miniBridge) return `${suitSymbols[r.strain]} ${r.level === 1 ? '一線' : '成局'}`;
  return r.level === 0
    ? 'PASS'
    : `${r.level}${suitSymbols[r.strain]}${r.doubled === 2 ? 'x' : r.doubled === 4 ? 'xx' : ''}`;
}
function resultText(r: ResultInput) {
  const delta = r.tricks - r.level - 6;
  return r.level === 0 ? '—' : delta === 0 ? '=' : signed(delta);
}
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? '連線失敗');
  return json;
}
function download(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Contract({ result }: { result?: Result }) {
  if (result?.status === 'average') return <span>平均分</span>;
  if (result?.status === 'cancelled') return <span className="cancelled-contract">取消</span>;
  return result ? (
    <span className={`contract ${result.strain === 'H' || result.strain === 'D' ? 'red' : ''}`}>
      {displayContract(result)}{' '}
      <small>
        {result.level ? seatNames[result.declarer] : ''} {resultText(result)}{result.split && ' · 判'}
      </small>
    </span>
  ) : (
    <span className="muted">待收分</span>
  );
}
export default function Scoreboard() {
  function positionDetail(trigger: HTMLButtonElement) {
    const target = trigger.getAttribute('popovertarget');
    requestAnimationFrame(() => {
      const popup = target ? document.getElementById(target) : null;
      if (!popup || !popup.matches(':popover-open')) return;
      const anchor = trigger.getBoundingClientRect();
      const box = popup.getBoundingClientRect();
      const left = Math.max(
        8,
        Math.min(anchor.left + anchor.width / 2 - box.width / 2, window.innerWidth - box.width - 8),
      );
      const top =
        anchor.bottom + box.height + 8 <= window.innerHeight
          ? anchor.bottom + 6
          : Math.max(8, anchor.top - box.height - 6);
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
    });
  }
  const [resultSort, setResultSort] = useState('table-asc');
  const [playerSort, setPlayerSort] = useState<'round' | 'board' | 'opponent'>('round');
  const [playerRound, setPlayerRound] = useState(1);
  const [travellerSide, setTravellerSide] = useState<'ns' | 'ew'>('ns');
  const [awayPerspective, setAwayPerspective] = useState(false);
  const [selectedResult, setSelectedResult] = useState('');
  const [resultSelection, setResultSelection] = useState(0);
  function chooseResult(id: string) {
    setSelectedResult((current) => (current === id ? '' : id));
    setResultSelection((value) => value + 1);
  }
  function sortHeading(key: 'table' | 'score' | 'points', label: string) {
    const active = resultSort.startsWith(key);
    const descending = resultSort.endsWith('desc');
    return (
      <th aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'}>
        <button
          type="button"
          className="traveller-sort"
          onClick={() =>
            setResultSort(
              `${key}-${active ? (descending ? 'asc' : 'desc') : key === 'table' ? 'asc' : 'desc'}`,
            )
          }
        >
          {label}
        </button>
      </th>
    );
  }
  const [events, setEvents] = useState<EventSummary[]>([]),
    [id, setId] = useState(''),
    [event, setEvent] = useState<PublicEvent | null>(null);
  const [tab, setTab] = useState<Tab>('standings'),
    [round, setRound] = useState(1),
    [board, setBoard] = useState(1),
    [person, setPerson] = useState('');
  const [query, setQuery] = useState(''),
    [follow, setFollow] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [admin, setAdmin] = useState(false),
    [configured, setConfigured] = useState(false),
    [mode, setMode] = useState('demo');
  const [director, setDirector] = useState(false);

  const [refreshCooldown, setRefreshCooldown] = useState(false);
  const manualRefreshUntil = useRef(0);
  useEffect(() => {
    if (!refreshCooldown) return;
    const timer = setTimeout(
      () => setRefreshCooldown(false),
      Math.max(0, manualRefreshUntil.current - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [refreshCooldown]);
  const [showPassword, setShowPassword] = useState(false);
  const [dashboardCollapsed, setDashboardCollapsed] = useState(false);
  useEffect(() => {
    if (tab !== 'admin') return;
    setDashboardCollapsed(true);
    try {
      localStorage.setItem('bridge-dashboard-collapsed', 'true');
    } catch {}
  }, [tab]);
  useEffect(() => {
    try {
      setDashboardCollapsed(localStorage.getItem('bridge-dashboard-collapsed') === 'true');
    } catch {}
  }, []);
  function toggleSection(section: 'dashboard') {
    const next = !dashboardCollapsed;
    setDashboardCollapsed(next);
    try {
      localStorage.setItem(`bridge-${section}-collapsed`, String(next));
    } catch {}
  }
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const [showLogin, setShowLogin] = useState(false),
    [password, setPassword] = useState(''),
    [loginError, setLoginError] = useState(''),
    [loggingIn, setLoggingIn] = useState(false);
  const requestGeneration = useRef(0),
    firstLoad = useRef(true);
  const refreshList = useCallback(async () => {
    const data = await api<{ events: EventSummary[]; storage: string }>('/api/events');
    setEvents(data.events);
    setMode(data.storage);
    return data.events;
  }, []);
  useEffect(() => {
    Promise.all([
      refreshList(),
      api<{ admin: boolean; director: boolean; configured: boolean; storage: string }>(
        '/api/session',
      ),
    ])
      .then(([list, session]) => {
        setAdmin(session.admin);
        setDirector(session.director);
        setConfigured(session.configured);
        setMode(session.storage);
        const params = new URLSearchParams(location.search),
          requested = params.get('event');
        setId(list.find((e) => e.id === requested)?.id ?? '');
        if (!list.some(e => e.id === requested)) setError('找不到賽事或賽段，請返回賽事入口。');
        const view = params.get('view');
        if (['standings', 'rounds', 'boards', 'players'].includes(view ?? '')) setTab(view as Tab);
        const b = Number(params.get('board'));
        if (b > 0 && b <= 128) setBoard(b);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    try {
      setFollow(localStorage.getItem('bridge-follow') ?? '');
    } catch {}
  }, [refreshList]);
  const refreshEvent = useCallback(
    async (signal?: AbortSignal) => {
      if (!id) return;
      const generation = ++requestGeneration.current;
      const data = await api<PublicEvent>(`/api/events/${encodeURIComponent(id)}`, { signal });
      if (generation === requestGeneration.current) {
        setEvent(data);
        setError('');
      }
    },
    [id],
  );
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setEvent(null);
    setError('');
    setQuery('');
    setPerson('');
    setRound(1);
    if (!firstLoad.current) setBoard(1);
    firstLoad.current = false;
    refreshEvent(controller.signal).catch((e) => {
      if (e.name !== 'AbortError') setError(e.message);
    });
    return () => {
      controller.abort();
      requestGeneration.current++;
    };
  }, [refreshEvent]);
  useEffect(() => {
    if (!id) return;
    const params = new URLSearchParams({ event: id, view: tab === 'admin' ? 'standings' : tab });
    if (tab === 'boards') params.set('board', String(board));
    history.replaceState(null, '', `?${params}`);
  }, [id, tab, board]);
  useEffect(() => {
    if (!event || event.status === 'finished' || tab === 'admin') return;
    let alive = true,
      timer: ReturnType<typeof setTimeout>,
      failures = 0;
    const tick = async () => {
      if (!alive) return;
      if (!document.hidden) {
        try {
          await refreshEvent();
          failures = 0;
        } catch {
          failures++;
          setError('更新失敗，保留上次成績。連線恢復後會重試。');
        }
      }
      if (alive) timer = setTimeout(tick, Math.min(120000, 30000 * 2 ** failures));
    };
    timer = setTimeout(tick, 30000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [event?.id, event?.status, tab, refreshEvent]);
  async function refresh() {
    setRefreshing(true);
    try {
      await Promise.all([refreshEvent(), refreshList()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }
  async function manualRefresh() {
    if (refreshing || Date.now() < manualRefreshUntil.current) return;
    manualRefreshUntil.current = Date.now() + 5000;
    setRefreshCooldown(true);
    await refresh();
  }
  function toggleFollow(value: string) {
    const next = follow === value ? '' : value;
    setFollow(next);
    try {
      localStorage.setItem('bridge-follow', next);
    } catch {}
  }
  function openAdmin() {
    setShowPassword(false);
    if (!admin) setShowLogin(true);
    else if (!id && director) location.assign('/');
    else setTab('admin');
  }
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError('');
    try {
      const session = await api<{ director: boolean }>('/api/session', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      setAdmin(true);
      setDirector(session.director);
      setPassword('');
      setShowPassword(false);
      setShowLogin(false);
      setTab('admin');
      if (!id && session.director) location.assign('/');
    } catch (e) {
      setLoginError((e as Error).message);
    } finally {
      setLoggingIn(false);
    }
  }
  const name = (pid: string) => event?.participants.find((p) => p.id === pid)?.name ?? pid;
  const currentProgress = event ? (event.collectionProgress ?? roundProgress(event)) : null;
  const progressRound = currentProgress?.round ?? event?.currentRound ?? 0;
  const competitionComplete = event?.status === 'finished' || !!event && allRoundsComplete(event);
  const roundOnBreak = event?.roundPhase === 'break' || (!event?.club?.enabled &&
    !!currentProgress?.expected && currentProgress.received === currentProgress.expected);
  const currentTiming = event?.roundTimes?.[progressRound];
  const playerId = person || event?.participants[0]?.id;
  const playerMatch = event?.assignments.find(a => a.round === playerRound && a.room === 'open' && (a.ns === playerId || a.ew === playerId));
  const previousStandings = event?.kind === 'teams' && playerRound > 1 ? teamStandingsThroughRound(event, playerRound - 1) : [];
  let playerBand = 0;
  const playerRows = (event?.assignments ?? [])
    .filter((a) => a.ns === playerId || a.ew === playerId)
    .filter((a) => event?.kind !== 'teams' || a.round === playerRound)
    .flatMap((a) => a.boards.map((b) => ({ a, b })))
    .sort((left, right) => {
      if (playerSort === 'board') return left.b - right.b || left.a.round - right.a.round;
      if (playerSort === 'opponent') {
        const opponent = (a: typeof left.a) => (a.ns === playerId ? a.ew : a.ns);
        const order = opponent(left.a).localeCompare(opponent(right.a), 'en', { numeric: true });
        if (order) return order;
      }
      return left.a.round - right.a.round || left.b - right.b;
    })
    .map((row, index, rows) => {
      if (index > 0 && row.a.round !== rows[index - 1].a.round) playerBand++;
      return { ...row, shaded: playerBand % 2 === 1 };
    });
  const teamPlayerRows = playerRows.filter(({ a }) => a.room === 'open').map(({ a, b }) => {
    const closed = event?.assignments.find(other => other.matchId === a.matchId && other.room === 'closed');
    const openResult = event?.results[resultKey(a.id, b)];
    const closedResult = closed ? event?.results[resultKey(closed.id, b)] : undefined;
    const impDiff = !openResult || !closedResult || openResult.status === 'cancelled' || closedResult.status === 'cancelled'
      ? null
      : openResult.status === 'average' || closedResult.status === 'average'
        ? 0
        : teamBoardImps(openResult, closedResult)[a.ns === playerId ? 0 : 1];
    const scores = (event?.assignments ?? []).filter(other => other.boards.includes(b))
      .map(other => event?.results[resultKey(other.id, b)])
      .filter(result => result && result.status !== 'cancelled' && result.status !== 'average')
      .map(result => result!.nsScore);
    const mean = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
    const datum = mean === null ? null : Math.sign(mean) * Math.round(Math.abs(mean) / 10) * 10;
    const calculateButlers = (opponent = false) => [a, closed].map(assignment => {
      const result = assignment ? event?.results[resultKey(assignment.id, b)] : undefined;
      return result && assignment && result.status !== 'cancelled' && result.status !== 'average' && datum !== null
        ? imps(awardedResult(result, (assignment.ns === playerId) !== opponent ? 'ns' : 'ew')!.nsScore - datum) * ((assignment.ns === playerId) !== opponent ? 1 : -1) : null;
    });
    return { a, b, closed, impDiff, butlers: calculateButlers(), opponentButlers: calculateButlers(true) };
  });
  const playerButlers = teamPlayerRows.flatMap(row => row.butlers).filter((value): value is number => value !== null);
  const opponentButlerTotal = teamPlayerRows.flatMap(row => row.opponentButlers).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const playerButlerTotal = playerButlers.reduce((sum, value) => sum + value, 0);
  const cumulativePlayerStandings = event?.kind === 'teams' ? teamStandingsThroughRound(event, playerRound) : [];
  const playerImpTotal = teamPlayerRows.reduce((total, row) => total + (row.impDiff ?? 0), 0);
  const playerImpFor = teamPlayerRows.reduce((total, row) => total + Math.max(0, row.impDiff ?? 0), 0);
  const playerImpAgainst = teamPlayerRows.reduce((total, row) => total + Math.max(0, -(row.impDiff ?? 0)), 0);
  const playerMatchScore = event?.projection.matches.find(match => match.id === playerMatch?.matchId);
  const playerMatchVp = playerMatchScore
    ? playerMatchScore.a === playerId ? playerMatchScore.vpA : playerMatchScore.vpB
    : null;
  const playerVpBoards = playerMatchScore?.total ?? teamPlayerRows.length;
  const opponentMatchVp = playerMatchScore
    ? playerMatchScore.a === playerId ? playerMatchScore.vpB : playerMatchScore.vpA
    : null;
  const playerVpScale = playerVpBoards > 0
    ? Array.from({ length: Math.ceil(15 * Math.sqrt(playerVpBoards)) + 1 }, (_, margin) => ({
        margin, winner: vp(margin, playerVpBoards), loser: vp(-margin, playerVpBoards),
      }))
    : [];
  const selectedBoard = event?.boards.find((b) => b.number === board) ?? event?.boards[0];
  const boardRounds = event ? getBoardRounds(event) : [];
  const boardRound =
    boardRounds.find((r) => r.boards.includes(selectedBoard?.number ?? 0)) ?? boardRounds[0];
  const boardNumberInRound = boardRound?.boards.indexOf(selectedBoard?.number ?? 0) ?? 0;
  const completedBoardScores =
    event && selectedBoard
      ? event.assignments
          .filter((a) => a.boards.includes(selectedBoard.number))
          .map((a) => event.results[resultKey(a.id, selectedBoard.number)])
          .filter((r) => r && r.status !== 'cancelled' && r.status !== 'average')
          .map((r) => r.nsScore)
      : [];
  const averageBoardScore = completedBoardScores.length
    ? completedBoardScores.reduce((sum, score) => sum + score, 0) / completedBoardScores.length
    : null;
  const pairMethod = event?.pairMethod ?? 'mp';
  const displayBoardNumber = (n: number) => (n - 1) % (event?.maxBoardNumber ?? 32) + 1;
  const butlerDatum = averageBoardScore === null ? null : Math.sign(averageBoardScore) * Math.round(Math.abs(averageBoardScore) / 10) * 10;
  const butlerHint = (r?: Result) => r && r.status !== 'cancelled' && r.status !== 'average' && butlerDatum !== null
    ? <span className="muted butler-imp" title="Butler IMP（NS 視角）">({signed(imps(r.nsScore - butlerDatum))})</span> : null;
  const scoreSide = event?.kind === 'pairs' ? travellerSide : 'ns';
  const sideSign = scoreSide === 'ns' ? 1 : -1;
  const sideLabel = scoreSide.toUpperCase();
  const traveller =
    event && selectedBoard
      ? event.assignments
          .filter((a) => a.boards.includes(selectedBoard.number))
          .sort((a, b) => {
            if (event.kind === 'teams') return String(a.table).localeCompare(String(b.table), 'en', { numeric: true });
            if (resultSort.startsWith('table'))
              return (
                (String(a.table).localeCompare(String(b.table), 'en', { numeric: true }) ||
                  a.round - b.round) * (resultSort.endsWith('desc') ? -1 : 1)
              );
            const value = (assignment: Assignment) => {
              const key = resultKey(assignment.id, selectedBoard.number),
                r = event.results[key];
              if (!r || r.status === 'cancelled') return null;
              if (resultSort.startsWith('points')) {
                const points = event.projection.pairScores[key];
                const score = points?.[scoreSide];
                return score == null
                  ? null
                  : pairMethod === 'mp'
                    ? points.top > 0
                      ? score / points.top
                      : null
                    : score;
              }
              return r.nsScore * sideSign;
            };
            const x = value(a),
              y = value(b);
            return x === null
              ? y === null
                ? 0
                : 1
              : y === null
                ? -1
                : (x - y) * (resultSort.endsWith('desc') ? -1 : 1);
          })
      : [];
  const activeResult = event?.results[resultKey(selectedResult, selectedBoard?.number ?? 0)];
  const activeAssignment = event?.assignments.find(
    (a) => a.id === selectedResult && a.boards.includes(selectedBoard?.number ?? 0),
  );
  const activeNames = event ? tableNames(event.kind, event.participants, activeAssignment) : {};
  const selectedRoundMatches = event?.projection.matches.filter((m) => m.round === round) ?? [];
  const roundTeamStandings = event?.kind === 'teams' ? teamStandingsThroughRound(event, round) : [];
  function browseBoard(number: number) {
    setSelectedResult('');
    setBoard(number);
  }
  const boardNavigation =
    event && selectedBoard ? (
      <div className={`board-nav board-jump ${event.kind === 'pairs' ? 'pairs-board-jump' : ''}`}>
        <button
          className="icon-button"
          aria-label="上一副"
          disabled={selectedBoard.number <= 1}
          onClick={() => browseBoard(selectedBoard.number - 1)}
        >
          <ArrowLeft size={18} />
        </button>
        <label className="board-number-picker">
          <strong className="board-number" aria-hidden="true">{displayBoardNumber(selectedBoard.number)}</strong>
          <select aria-label="選擇牌號" value={selectedBoard.number}
            onChange={(e) => browseBoard(Number(e.target.value))}>
            {event.kind === 'teams'
              ? boardRounds.map((round) => (
                  <optgroup key={round.round} label={'第 ' + round.round + ' 圈'}>
                    {round.boards.map((number, index) => (
                      <option key={index} value={number}>牌號 {displayBoardNumber(number)}（圈內第 {index + 1} 牌）</option>
                    ))}
                  </optgroup>
                ))
              : event.boards.map((board) => (
                  <option key={board.number} value={board.number}>牌號 {displayBoardNumber(board.number)}</option>
                ))}
          </select>
        </label>
        <button
          className="icon-button"
          aria-label="下一副"
          disabled={selectedBoard.number >= event.boards.length}
          onClick={() => browseBoard(selectedBoard.number + 1)}
        >
          <ArrowRight size={18} />
        </button>
      </div>
    ) : null;
  const navItems: [Tab, string, typeof Trophy][] = [
    ['standings', '總排名', Trophy],
    ['rounds', '輪次與對戰', ClipboardList],
    ['boards', '逐副成績', Spade],
    ['players', event?.kind === 'pairs' ? '搭檔成績' : '隊伍成績', Users],
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="/" className="brand">
          <span className="brand-symbol" aria-hidden="true">♦</span>
          <span>
            <span className="sidebar-wordmark">VALET</span><small>橋牌賽事記分</small>
          </span>
        </a>
        <div className="sidebar-label">賽事工作區</div>
        <a className="workspace-button" href={`/?competition=${encodeURIComponent(event?.competition?.id ?? event?.parentEventId ?? id)}`}>
          <LayoutDashboard size={18} />
          <span>賽事主頁</span>
          <ChevronRight size={15} />
        </a>
        <div className="sidebar-label second">成績查詢</div>
        <nav>
          {navItems.map(([key, label, Icon]) => (
            <button
              key={key}
              className={`nav-item ${tab === key ? 'active' : ''}`}
              onClick={() => setTab(key)}
            >
              <Icon size={19} />
              {label}
              {key === tab && <span className="active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className={`nav-item ${tab === 'admin' ? 'active' : ''}`} onClick={openAdmin}>
            <Settings2 size={19} />
            {admin && !director ? '賽務功能表' : '裁判功能表'}
            <ChevronRight size={15} />
          </button>
          <div className="sidebar-note">
            <span className="tiny-suits">
              ♠ <b>♥ ♦</b> ♣
            </span>
            <p>再怎麼說橋牌還是太 Creepy 了</p>
            <small>Valet · MVP 0.1</small>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <Breadcrumbs items={event ? [
            { label: event.competition?.name ?? event.name, href: `/?competition=${encodeURIComponent(event.competition?.id ?? event.parentEventId ?? event.id)}` },
            { label: event.stageName ?? '賽事成績' },
          ] : [{ label: '賽事成績' }]} />
          <div className="top-actions">
            {admin ? (
              <SessionControl director={director} onMenu={openAdmin} onLogout={async () => {
                try {
                  await api('/api/session', { method: 'DELETE' });
                  setAdmin(false); setDirector(false); setTab('standings');
                } catch (e) { setError((e as Error).message); }
              }} />
            ) : (
              <button className="session-role session-login" onClick={openAdmin}>
                登入
              </button>
            )}
          </div>
        </header>
        <main>
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button onClick={refresh}>重新載入</button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              {notice}
              <button aria-label="關閉訊息" onClick={() => setNotice('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="empty">
              <LoaderCircle className="spin" />
              載入賽事中…
            </div>
          ) : (
            <>
              {id && !event && !error && (
                <div className="empty">
                  <LoaderCircle className="spin" />
                  載入成績中…
                </div>
              )}
              {event && (
                <>
                  <section className="event-heading">
                    <div className="event-intro">
                      {event.stageName && <div className="section-kicker">{event.competition?.name ?? event.name}</div>}
                      <h1>
                        <button
                          className="event-title-button"
                          popoverTarget="event-information"
                          onClick={(e) => positionDetail(e.currentTarget)}
                          aria-label="查看比賽資訊"
                        >
                          {(event.stageName ?? event.name).split(/\s+/).map((part, index) => (
                            <span className="event-name-part" key={index}>
                              {index > 0 ? ' ' : ''}
                              {part}
                            </span>
                          ))}
                        </button>
                      </h1>
                      <div
                        id="event-information"
                        key={event.id}
                        popover="auto"
                        className="player-detail-popover event-information"
                      >
                        <strong>{[event.prefix, event.name].filter(Boolean).join(' ')}</strong>
                        <div>日期：{event.date}</div>
                        <div>地點：{event.venue || '線上記分'}</div>
                      </div>
                      <div className="event-meta">
                        <span className="event-format">
                          {event.gameMode === 'minibridge' && 'MiniBridge · 無身價 · '}
                          {event.kind === 'teams'
                            ? 'IMP · WBF 20-0 VP'
                            : `${methodNames[pairMethod]} · 合併排名 · ${event.trim === 'one' ? '各去一筆' : event.trim === 'ten-percent' ? '各去 10%' : '不去頭尾'}`}
                        </span>
                      </div>
                    </div>
                    <button
                      className={`button subtle ${refreshing ? 'refreshing' : ''}`}
                      disabled={refreshing || refreshCooldown}
                      onClick={manualRefresh}
                    >
                      <Activity size={16} />
                      {refreshing ? '更新中' : '更新成績'}
                    </button>
                  </section>
                  {event.demo && (
                    <div className="demo-banner">
                      <span>範例賽事</span> 使用模擬成績與牌型，供操作展示。
                      {mode === 'demo'
                        ? '目前為唯讀模式。'
                        : '可在後台試填；正式比賽請裁判建立新賽事。'}
                    </div>
                  )}
                  <button
                    className="section-collapse"
                    aria-expanded={!dashboardCollapsed}
                    aria-controls="event-dashboard"
                    onClick={() => toggleSection('dashboard')}
                  >
                    <span>
                      比賽進度
                      {dashboardCollapsed &&
                        (competitionComplete
                          ? ' · 賽事已結束'
                          : progressRound
                            ? ` · 第 ${progressRound}/${event.rounds} 圈${roundOnBreak ? ' · 圈間休息' : ''}`
                            : ' · 尚未開始')}
                    </span>
                    <ChevronDown size={15} className={dashboardCollapsed ? 'collapsed' : ''} />
                  </button>
                  <div id="event-dashboard" className="stats-grid" hidden={dashboardCollapsed}>
                    <Stat
                      label={event.kind === 'teams' ? '參賽隊伍' : '參賽搭檔'}
                      value={event.participants.length}
                      suffix={event.kind === 'teams' ? '隊' : '對'}
                      icon={<Users />}
                      popoverTarget="award-information"
                      onClick={(e) => positionDetail(e.currentTarget)}
                    />
                    <Stat
                      label="目前圈數"
                      value={progressRound}
                      suffix={`/ ${event.rounds} 圈`}
                      detail={
                        competitionComplete
                          ? '賽事已結束'
                          : !progressRound
                            ? '尚未開始'
                            : roundOnBreak
                              ? '圈間休息'
                              : undefined
                      }
                      icon={<Flag />}
                      popoverTarget="current-round-information"
                      onClick={(e) => positionDetail(e.currentTarget)}
                    />
                    <Stat
                      label="比賽牌數"
                      value={event.boards.length}
                      suffix="副"
                      icon={<Spade />}
                      popoverTarget="movement-information"
                      onClick={(e) => positionDetail(e.currentTarget)}
                      detail={`每圈 ${event.boardsPerRound} 牌`}
                    />
                    <Stat
                      label="本圈已收成績"
                      value={currentProgress?.received ?? 0}
                      suffix={`/ ${currentProgress?.expected ?? 0}`}
                      progress={
                        currentProgress?.expected
                          ? currentProgress.received / currentProgress.expected
                          : 0
                      }
                      popoverTarget="current-round-progress"
                      onClick={(e) => positionDetail(e.currentTarget)}
                    />
                  </div>
                  <div id="award-information" popover="auto" className="player-detail-popover">
                    <strong>給獎資訊</strong>
                    <div>{(event.awardPlaces ?? 3) === 0 ? '不給獎' : '給獎範圍：前 ' + (event.awardPlaces ?? 3) + ' 名（同分並列）'}</div>
                    <div className="description-text">{event.awardDescription || '尚未公布給獎內容'}</div>
                  </div>
                  <div id="movement-information" popover="auto" className="player-detail-popover">
                    <strong>賽程編排說明</strong>
                    <div className="description-text">{event.movementDescription || '尚未提供詳細說明'}</div>
                    <div>{event.rounds} 圈，每圈 {event.boardsPerRound} 牌；共 {event.boards.length} 副牌。</div>
                    <div>實際對戰、牌組與輪空請見「輪次與對戰」。</div>
                  </div>
                  <div
                    id="current-round-information"
                    key={`time-${event.id}-${event.currentRound}`}
                    popover="auto"
                    className="player-detail-popover"
                  >
                    <strong>
                      {competitionComplete ? '賽事已結束' : progressRound
                        ? `第 ${progressRound} 圈${roundOnBreak ? ' · 圈間休息' : ''}`
                        : '裁判尚未指定目前圈數'}
                    </strong>
                    <div>
                      {currentTiming
                        ? `${new Date(currentTiming.startAt).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, hour: '2-digit', minute: '2-digit' })} — ${new Date(currentTiming.endAt).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, hour: '2-digit', minute: '2-digit' })}（臺灣時間）`
                        : '尚未設定本圈時間區間'}
                    </div>
                  </div>
                  <div
                    id="current-round-progress"
                    key={`progress-${event.id}-${event.currentRound}`}
                    popover="auto"
                    className="player-detail-popover"
                  >
                    {!currentProgress?.round ? (
                      '尚未指定目前圈數'
                    ) : !currentProgress.expected ? (
                      '本圈尚未安排賽程'
                    ) : currentProgress.slowest.length === 0 ? (
                      '本圈成績已收齊'
                    ) : (
                      <>
                        <strong>本圈進度最慢桌</strong>
                        {currentProgress.slowest.map(({ assignment, received, expected }) => (
                          <div key={assignment.id}>
                            桌 {assignment.table}
                            {assignment.room === 'open'
                              ? ' · 開室'
                              : assignment.room === 'closed'
                                ? ' · 閉室'
                                : ''}
                            ：{received} / {expected}
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                  <div className="mobile-tabs">
                    {navItems.map(([key, label]) => (
                      <button
                        className={tab === key ? 'selected' : ''}
                        key={key}
                        onClick={() => setTab(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {tab === 'standings' && (
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h3>
                            總排名{' '}
                            <span className="badge">
                              {competitionComplete ? '最終成績' : '暫定成績'}
                            </span>
                          </h3>
                          <p>
                            {event.kind === 'teams'
                              ? 'VP 僅計入開閉兩室全部收齊的對戰；同分並列。'
                              : '依有效結果暫時計分，排名包含罰分計算，同分並列。'}
                          </p>
                        </div>
                        <label className="search">
                          <Search size={17} />
                          <input
                            aria-label="搜尋參賽者"
                            placeholder={event.kind === 'teams' ? '搜尋隊名…' : '搜尋姓名或搭檔…'}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                        </label>
                      </div>
                      <div className="table-scroll">
                        <table className={`ranking-table${event.kind === 'teams' ? ' team-ranking-table' : ''}`}>
                          <thead>
                            <tr>
                              <th className="rank-col">排名</th>
                              <th>{event.kind === 'teams' ? '隊伍' : '搭檔'}</th>
                              <th>完成／安排牌數</th>
                              <th className="score-col">
                                {event.kind === 'teams'
                                  ? '累計 VP'
                                  : pairMethod === 'mp'
                                    ? '總百分比'
                                    : '總 IMP'}
                              </th>
                              <th aria-label="追蹤" />
                            </tr>
                          </thead>
                          <tbody>
                            {event.projection.standings
                              .filter(
                                (s) =>
                                  s.name.toLowerCase().includes(query.toLowerCase()) ||
                                  participantNumber(s.id, event.kind).toLowerCase().includes(query.toLowerCase()),
                              )
                              .map((s) => (
                                <tr
                                  key={s.id}
                                  className={follow === `${id}:${s.id}` ? 'followed' : ''}
                                >
                                  <td>
                                    <span className={`rank rank-${s.rank}`}>
                                      {s.rank <= (event.awardPlaces ?? 3) ? (
                                        <>
                                          <Trophy size={13} />
                                          {s.rank}
                                        </>
                                      ) : (
                                        String(s.rank).padStart(2, '0')
                                      )}
                                    </span>
                                  </td>
                                  <td>
                                    <button
                                      className="participant-link"
                                      onClick={() => {
                                        setPerson(s.id);
                                        setTab('players');
                                      }}
                                    >
                                      <span>
                                        <span className="standing-name" title={s.name}>{s.name}</span>
                                        <small>
                                          {participantNumber(s.id, event.kind)}{event.kind !== 'teams' && s.players && ` · ${s.players}`}
                                        </small>
                                      </span>
                                    </button>
                                  </td>
                                  <td>
                                    <span className="mono">
                                      {s.played} <span className="muted">/ {s.total}</span>
                                    </span>
                                  </td>
                                  <td className="big-score">
                                    <button
                                      className="contract-link"
                                      popoverTarget={`standing-${s.id}`}
                                      onClick={(e) => positionDetail(e.currentTarget)}
                                      aria-label={`查看 ${s.name} 總分明細`}
                                    >
                                      {number(
                                        s.score,
                                        pairMethod === 'butler' &&
                                          event.kind === 'pairs' &&
                                          Number.isInteger(s.score)
                                          ? 0
                                          : 2,
                                      )}
                                      <small>
                                        {event.kind === 'pairs' && pairMethod === 'mp' ? '%' : ''}
                                      </small>
                                    </button>
                                    <div
                                      id={`standing-${s.id}`}
                                      popover="auto"
                                      className="player-detail-popover"
                                    >
                                      <div>
                                        {event.kind === 'teams'
                                          ? '淨 IMP'
                                          : pairMethod === 'mp'
                                            ? '累計 MP'
                                            : '累計 IMP'}
                                        ：
                                        {number(
                                          s.secondary,
                                          pairMethod === 'butler' && event.kind === 'pairs' ? 0 : 2,
                                        )}
                                      </div>
                                      <div>
                                        調整{' '}
                                        {event.kind === 'teams'
                                          ? 'VP'
                                          : pairMethod === 'mp'
                                            ? 'MP'
                                            : 'IMP'}
                                        ：
                                        {number(
                                          s.penalty ?? 0,
                                          pairMethod === 'butler' &&
                                            Number.isInteger(s.penalty ?? 0)
                                            ? 0
                                            : 2,
                                        )}
                                      </div>
                                    </div>
                                  </td>
                                  <td>
                                    <button
                                      className={`icon-button follow-button ${follow === `${id}:${s.id}` ? 'on' : ''}`}
                                      aria-label={`追蹤 ${s.name}`}
                                      aria-pressed={follow === `${id}:${s.id}`}
                                      onClick={() => toggleFollow(`${id}:${s.id}`)}
                                    >
                                      <Star size={17} />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                        {!event.projection.standings.some(
                          (s) =>
                            s.name.toLowerCase().includes(query.toLowerCase()) ||
                            participantNumber(s.id, event.kind).toLowerCase().includes(query.toLowerCase()),
                        ) && <div className="empty compact">沒有符合的參賽者</div>}
                      </div>
                      <div className="table-footer">
                        <span>
                          <i className="live-dot" />
                          {event.status === 'finished' ? '賽事已結束' : '成績每 30 秒更新'} · v
                          {event.revision}
                        </span>
                        <span>
                          最後更新{' '}
                          {new Date(event.updatedAt).toLocaleString('zh-TW', {
                            timeZone: 'Asia/Taipei',
                            hour12: false,
                          })}
                        </span>
                      </div>
                    </section>
                  )}
                  {tab === 'rounds' && (
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h3>輪次與對戰</h3>
                          <p>
                            {event.kind === 'teams'
                              ? '查看各輪 IMP 比較與收分進度。'
                              : '查看桌次、南北／東西搭檔與牌組安排。'}
                          </p>
                        </div>
                        <RoundSelect count={event.rounds} round={round} setRound={setRound} />
                      </div>
                      {event.kind === 'teams' ? (
                        <div className="match-grid">
                          {selectedRoundMatches.map((m) => (
                            <div className="match-card" key={m.id}>
                              <div className="match-meta">
                                第 {event.assignments.find(a => a.matchId === m.id)?.table ?? '—'} 桌{' '}
                                <span>
                                  {m.completed === m.total
                                    ? '已收齊'
                                    : `已比對 ${m.completed} / ${m.total} 副`}
                                </span>
                              </div>
                              {[m.a, m.b].map((id, index) => {
                                const standing = roundTeamStandings.find(s => s.id === id);
                                return (
                                  <div className={`match-team ${index === 0 ? 'team-home' : 'team-away'}`} key={id}>
                                    <button className="match-team-link" onClick={() => { setPerson(id); setTab('players'); }}>
                                      <strong>{name(id)}</strong>
                                      <small>{participantNumber(id, event.kind)} / {number(standing?.score ?? null)} VP{standing && ` / #${standing.rank}`}</small>
                                    </button>
                                    <b>{m.split ? `${signed(index === 0 ? m.marginA : m.marginB)} IMP 淨差` : index === 0 ? m.impsA : m.impsB}</b>
                                  </div>
                                );
                              })}
                              <div className="match-bottom">
                                <span>
                                  VP{' '}
                                  <b>
                                    <span className="team-home">{number(m.vpA)}</span> : <span className="team-away">{number(m.vpB)}</span>
                                  </b>
                                </span>
                                <button
                                  onClick={() => {
                                    setBoard(
                                      event.assignments.find((a) => a.matchId === m.id)!.boards[0],
                                    );
                                    setTab('boards');
                                  }}
                                >
                                  逐副比較 <ArrowRight size={14} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="table-scroll">
                          <table className="round-pairs-table">
                            <thead>
                              <tr>
                                <th>桌號</th>
                                <th>南北 NS</th>
                                <th>東西 EW</th>
                                <th>牌號</th>
                                <th>完成</th>
                              </tr>
                            </thead>
                            <tbody>
                              {event.assignments
                                .filter((a) => a.round === round)
                                .map((a) => (
                                  <tr key={a.id}>
                                    <td className="mono">{a.table}</td>
                                    {[a.ns, a.ew].map((id) => {
                                      const standing = event.projection.standings.find(
                                        (s) => s.id === id,
                                      );
                                      const score = standing?.score;
                                      return (
                                        <td key={id}>
                                          <button
                                            className="participant-link"
                                            onClick={() => {
                                              setPerson(id);
                                              setTab('players');
                                            }}
                                          >
                                            <span>
                                              {name(id)}
                                              <small className="round-pair-summary">
                                                {participantNumber(id, event.kind)} /{' '}
                                                {score == null
                                                  ? '—'
                                                  : `${pairMethod !== 'mp' && score >= 0 ? '+' : ''}${number(score, pairMethod === 'butler' && Number.isInteger(score) ? 0 : 2)}${pairMethod === 'mp' ? '%' : ' IMP'}`}
                                                {standing && ` / #${standing.rank}`}
                                              </small>
                                            </span>
                                          </button>
                                        </td>
                                      );
                                    })}
                                    <td>
                                      <button
                                        className="text-button"
                                        onClick={() => {
                                          setBoard(a.boards[0]);
                                          setTab('boards');
                                        }}
                                      >
                                        {a.boards.length >= 3 &&
                                        a.boards.every(
                                          (b, i) => i === 0 || b === a.boards[i - 1] + 1,
                                        )
                                          ? `${a.boards[0]}-${a.boards[a.boards.length - 1]}`
                                          : a.boards.join(', ')}
                                      </button>
                                    </td>
                                    <td>
                                      {
                                        a.boards.filter((b) => event.results[resultKey(a.id, b)])
                                          .length
                                      }{' '}
                                      / {a.boards.length}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                          <div className="table-footer">
                            {event.assignments.some((a) => a.round === round) ? (
                              <>
                                輪空：
                                {event.participants
                                  .filter(
                                    (p) =>
                                      !event.assignments.some(
                                        (a) =>
                                          a.round === round && (a.ns === p.id || a.ew === p.id),
                                      ),
                                  )
                                  .map((p) => p.name)
                                  .join('、') || '無'}
                              </>
                            ) : (
                              '本圈賽程尚未安排'
                            )}
                          </div>
                        </div>
                      )}
                    </section>
                  )}
                  {tab === 'boards' && selectedBoard && (
                    <>
                      <div className="board-layout">
                        {activeResult?.split && <section className="panel"><div className="panel-heading"><h3>不平衡合約</h3><p className="footnote">下方牌局保留原始紀錄；判罰後各方分別依下列合約計分。</p>{(['ns','ew'] as const).map(side => <p key={side}>{side.toUpperCase()} 獲判：<Contract result={awardedResult(activeResult, side)} /> · <span className="mono">{signed(awardedResult(activeResult, side)!.nsScore * (side === 'ns' ? 1 : -1))}</span></p>)}</div></section>}
                        <section className="panel deal-panel">
                          {hasDeal(selectedBoard) && selectedBoard.deal.N.length === 13 ? (
                            <DealExplorer
                              key={`${event.id}:${selectedBoard.number}`}
                              board={selectedBoard}
                              miniBridge={event.gameMode === 'minibridge'}
                              result={activeResult}
                              playerNames={activeNames}
                              resultSelection={resultSelection}
                              tableSelected={!!activeAssignment}
                              onManualTrial={() => setSelectedResult('')}
                              navigation={boardNavigation}
                              averageScore={
                                averageBoardScore === null ? null : averageBoardScore * sideSign
                              }
                              scoreSide={sideLabel}
                              validResults={completedBoardScores.length}
                            />
                          ) : (
                            <div className="unpublished-board">
                              <BoardInformation
                                number={selectedBoard.number}
                                averageScore={
                                  averageBoardScore === null ? null : averageBoardScore * sideSign
                                }
                                scoreSide={sideLabel}
                                validResults={completedBoardScores.length}
                                navigation={boardNavigation}
                              />
                              <DealDiagram board={selectedBoard} />
                            </div>
                          )}
                          {hasDeal(selectedBoard) && selectedBoard.deal.N.length > 0 && (
                            <div className="board-export-actions">
                            <button
                              className="button subtle"
                              onClick={() =>
                                download(
                                  `board-${selectedBoard.number}.pbn`,
                                  exportPbn({ boards: [selectedBoard] }),
                                )
                              }
                            >
                              <ArrowDownToLine size={15} />
                              下載此副 PBN
                            </button>
                            <a className="button subtle" href={handviewerUrl(selectedBoard)} target="_blank" rel="noopener noreferrer">
                              <ArrowRight size={15} />
                              輸出至 Handviewer
                            </a>
                            </div>
                          )}
                        </section>
                        <section className="panel board-results">
                          <div className="panel-heading">
                            <div>
                              <h3>{event.kind === 'teams' ? '開閉兩室逐副比較' : '單副成績表'}</h3>
                            </div>
                            {event.kind === 'teams' && (
                              <button type="button" className="button subtle" aria-pressed={awayPerspective} onClick={() => setAwayPerspective(value => !value)}>
                                {awayPerspective ? '切換主隊視角' : '切換客隊視角'}
                              </button>
                            )}
                          </div>
                          <div className="table-scroll">
                            {event.kind === 'teams' ? (
                              <table>
                                <thead>
                                  <tr>
                                    <th>對戰</th>
                                    <th>我方合約</th>
                                    <th>對方合約</th>
                                    <th>IMP</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {traveller
                                    .filter(
                                      (a) =>
                                        a.room === 'open' &&
                                        a.boards.includes(selectedBoard.number),
                                    )
                                    .map((a) => {
                                      const closed = event.assignments.find(
                                        (c) => c.matchId === a.matchId && c.room === 'closed',
                                      )!;
                                      const x =
                                          event.results[resultKey(a.id, selectedBoard.number)],
                                        y =
                                          event.results[resultKey(closed.id, selectedBoard.number)];
                                      const own = awardedResult(awayPerspective ? y : x, 'ns');
                                      const opponent = awardedResult(awayPerspective ? x : y, 'ew');
                                      const ownTable = awayPerspective ? closed : a;
                                      const opponentTable = awayPerspective ? a : closed;
                                      return (
                                        <tr
                                          key={a.id}
                                          className={
                                            selectedResult === a.id || selectedResult === closed.id
                                              ? 'selected-result selectable-result'
                                              : 'selectable-result'
                                          }
                                          tabIndex={0}
                                          role="button"
                                          aria-pressed={selectedResult === ownTable.id}
                                          onClick={() => chooseResult(ownTable.id)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                              e.preventDefault();
                                              chooseResult(ownTable.id);
                                            }
                                          }}
                                          aria-label={`選取第 ${a.table} 桌我方合約`}
                                        >
                                          <td>
                                            <strong className="board-team-name" title={name(awayPerspective ? a.ew : a.ns)}>{name(awayPerspective ? a.ew : a.ns)}</strong>
                                            <small className="block muted board-team-name" title={name(awayPerspective ? a.ns : a.ew)}>vs {name(awayPerspective ? a.ns : a.ew)}</small>
                                          </td>
                                          <td>
                                            <Contract result={own} />
                                            <small className="block mono team-raw-score">
                                              {own?.status === 'average' ? '平均分' : own && own.status !== 'cancelled'
                                                ? signed(own.nsScore)
                                                : '—'}
                                              {butlerHint(own)}
                                            </small>
                                          </td>
                                          <td
                                            tabIndex={0}
                                            role="button"
                                            aria-label={`選取第 ${a.table} 桌對方合約，查看首攻`}
                                            aria-pressed={selectedResult === opponentTable.id}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              chooseResult(opponentTable.id);
                                            }}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                chooseResult(opponentTable.id);
                                              }
                                            }}
                                          >
                                            <Contract result={opponent} />
                                            <small className="block mono team-raw-score">
                                              {opponent?.status === 'average' ? '平均分' : opponent && opponent.status !== 'cancelled'
                                                ? signed(opponent.nsScore)
                                                : '—'}
                                              {butlerHint(opponent)}
                                            </small>
                                          </td>
                                          <td className="accent mono">
                                            {x?.status === 'cancelled' || y?.status === 'cancelled'
                                              ? '取消'
                                              : x && y
                                                ? signed(x.status === 'average' || y.status === 'average' ? 0 : teamBoardImps(x, y)[awayPerspective ? 1 : 0])
                                                : '—'}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                </tbody>
                              </table>
                            ) : (
                              <table>
                                <thead>
                                  <tr>
                                    {sortHeading('table', '桌／輪')}
                                    <th>
                                      <button
                                        type="button"
                                        className="traveller-sort side-switch"
                                        aria-label={`目前 ${sideLabel}，切換為 ${travellerSide === 'ns' ? 'EW' : 'NS'}`}
                                        onClick={() =>
                                          setTravellerSide(travellerSide === 'ns' ? 'ew' : 'ns')
                                        }
                                      >
                                        <span
                                          className={
                                            travellerSide === 'ns' ? 'side-active' : 'side-muted'
                                          }
                                        >
                                          NS
                                        </span>{' '}
                                        /{' '}
                                        <span
                                          className={
                                            travellerSide === 'ew' ? 'side-active' : 'side-muted'
                                          }
                                        >
                                          EW
                                        </span>
                                      </button>
                                    </th>
                                    <th>合約</th>
                                    {sortHeading('score', `${sideLabel} 分`)}
                                    {sortHeading(
                                      'points',
                                      `${sideLabel} ${pairMethod === 'mp' ? 'MP%' : 'IMP'}`,
                                    )}
                                  </tr>
                                </thead>
                                <tbody>
                                  {traveller
                                    .filter((a) => a.boards.includes(selectedBoard.number))
                                    .map((a) => {
                                      const key = resultKey(a.id, selectedBoard.number),
                                        r = event.results[key],
                                        mp = event.projection.pairScores[key];
                                      return (
                                        <tr
                                          key={a.id}
                                          className={
                                            selectedResult === a.id
                                              ? 'selected-result selectable-result'
                                              : 'selectable-result'
                                          }
                                          tabIndex={0}
                                          role="button"
                                          aria-label={`選取第 ${a.table} 桌，查看首攻`}
                                          aria-pressed={selectedResult === a.id}
                                          onClick={() => chooseResult(a.id)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                              e.preventDefault();
                                              chooseResult(a.id);
                                            }
                                          }}
                                        >
                                          <td className="table-round">
                                            {a.table} <small className="muted">/ R{a.round}</small>
                                          </td>
                                          <td>
                                            <span
                                              className={`block ${travellerSide === 'ns' ? 'side-active' : 'side-muted'}`}
                                            >
                                              {name(a.ns)}
                                            </span>
                                            <span
                                              className={`block ${travellerSide === 'ew' ? 'side-active' : 'side-muted'}`}
                                            >
                                              {name(a.ew)}
                                            </span>
                                          </td>
                                          <td>
                                            <Contract result={r} />
                                          </td>
                                          <td className="mono">
                                            {r && r.status !== 'cancelled'
                                              ? signed(r.nsScore * sideSign)
                                              : '—'}
                                          </td>
                                          <td
                                            className={`mono ${pairTone(mp?.[travellerSide], mp?.top ?? 0, pairMethod)}`}
                                          >
                                            {pairValue(
                                              mp?.[travellerSide],
                                              mp?.top ?? 0,
                                              pairMethod,
                                            )}
                                            {mp?.provisional && (
                                              <small className="block muted">暫定</small>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                </tbody>
                              </table>
                            )}
                          </div>
                          {event.kind === 'teams' && (
                            <p className="footnote">
                              {awayPerspective
                                ? '目前為客隊視角：IMP 以左列第一支隊伍為正，閉室 NS 分減去開室 NS 分後換算。'
                                : '目前為主隊視角：IMP 以左列第一支隊伍為正，開室 NS 分減去閉室 NS 分後換算。'}
                            </p>
                          )}
                        </section>
                      </div>
                    </>
                  )}
                  {tab === 'players' && (
                    <section className="panel player-results">
                      <div className="panel-heading">
                        <div>
                          <h3>{event.kind === 'teams' ? '隊伍' : '搭檔'}個別成績</h3>
                          {event.kind === 'teams' && event.participants.find(p => p.id === (person || event.participants[0].id))?.captain && (
                            <p>隊長：{event.participants.find(p => p.id === (person || event.participants[0].id))?.captain}</p>
                          )}
                          {event.kind === 'teams' && event.participants.find(p => p.id === (person || event.participants[0].id))?.players && (
                            <p>隊員：{event.participants.find(p => p.id === (person || event.participants[0].id))?.players}</p>
                          )}
                        </div>
                        <div className={`player-result-filters${event.kind === 'teams' ? '' : ' pairs-result-filters'}`}>
                        <div className="participant-picker">
                          查看{event.kind === 'teams' ? '隊伍' : '搭檔'}
                          <button
                            className="participant-picker-trigger"
                            aria-label="選擇參賽者"
                            popoverTarget="participant-options"
                            onClick={(e) => positionDetail(e.currentTarget)}
                          >
                            <span><span className="participant-picker-number">{participantNumber((person || event.participants[0].id), event.kind)}</span>{event.kind === 'pairs' ? name(person || event.participants[0].id).trim().replace(/\s+/g, ' ') : name(person || event.participants[0].id)}</span>
                            <ChevronDown size={16} />
                          </button>
                          <div
                            id="participant-options"
                            popover="auto"
                            className="player-detail-popover participant-options"
                          >
                            {event.participants.map((p) => (
                              <button
                                type="button"
                                key={p.id}
                                aria-pressed={p.id === (person || event.participants[0].id)}
                                onClick={(e) => {
                                  setPerson(p.id);
                                  (
                                    e.currentTarget.closest('[popover]') as HTMLElement
                                  )?.hidePopover();
                                }}
                              >
                                <span><span className="participant-picker-number">{participantNumber(p.id, event.kind)}</span>{event.kind === 'pairs' ? p.name.trim().replace(/\s+/g, ' ') : p.name}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        {event.kind === 'teams' && <label className="participant-picker">
                          查看圈次
                          <select aria-label="選擇成績圈次" value={playerRound} onChange={e => setPlayerRound(Number(e.target.value))}>
                            {Array.from({ length: event.rounds }, (_, i) => <option key={i + 1} value={i + 1}>第 {i + 1} 圈</option>)}
                          </select>
                        </label>}
                        </div>
                        {event.kind === 'teams' && <div className="player-round-context">
                          {playerMatch ? <>
                            <button
                              type="button"
                              className="contract-link"
                              popoverTarget="player-preround-summary"
                              onClick={e => positionDetail(e.currentTarget)}
                            >第 {playerMatch.table} 桌 · 對手：{name(playerMatch.ns === playerId ? playerMatch.ew : playerMatch.ns)}</button>
                            <div
                              key={`${playerId}-${playerRound}`}
                              id="player-preround-summary"
                              popover="auto"
                              className="player-detail-popover"
                            >
                            <small>{playerRound === 1 ? '賽前' : `截至第 ${playerRound - 1} 圈`}</small>
                            {[playerId!, playerMatch.ns === playerId ? playerMatch.ew : playerMatch.ns].map((id, i) => {
                              const standing = previousStandings.find(s => s.id === id);
                              return <div key={id}>{i === 0 ? '我方' : '對手'}：{playerRound === 1 ? '0.00 VP · 尚無排名' : `${number(standing?.score ?? null)} VP · #${standing?.rank ?? '—'}`}</div>;
                            })}
                            </div>
                          </> : <div>本圈無對戰安排</div>}
                        </div>}
                      </div>
                      <div className="table-scroll">
                        {event.kind === 'teams' && <table className="team-player-results">
                          <thead><tr><th>牌號</th><th>公開</th><th>關閉</th><th>IMP 差</th></tr></thead>
                          <tbody>
                            {teamPlayerRows.map(({ a, b, closed, impDiff, butlers }) => {
                              const openBoard = (assignment?: Assignment) => {
                                setSelectedResult(assignment?.id ?? '');
                                setBoard(b);
                                setTab('boards');
                              };
                              return <tr key={`${a.matchId}-${b}`}>
                                <td><button className="text-button" onClick={() => openBoard(a)}>{displayBoardNumber(b)}</button></td>
                                {[a, closed].map((assignment, index) => {
                                  const result = assignment ? awardedResult(event.results[resultKey(assignment.id, b)], assignment.ns === playerId ? 'ns' : 'ew') : undefined;
                                  const ownScore = result && assignment ? result.nsScore * (assignment.ns === playerId ? 1 : -1) : null;
                                  const butler = butlers[index];
                                  return <td key={index}>
                                    <button className="contract-link" aria-label={`查看牌號 ${displayBoardNumber(b)} ${index === 0 ? '公開' : '關閉'}室成績`} onClick={() => openBoard(assignment)}>
                                      <Contract result={result} />

                                      <small className="block mono team-raw-score">{result?.status === 'average' ? '平均分' : result?.status === 'cancelled' || ownScore === null ? '—' : signed(ownScore)}
                                        {butler !== null && <span className="muted butler-imp" title="Butler IMP（我方視角）" aria-label={`Butler IMP ${signed(butler)}`}>({signed(butler)})</span>}
                                      </small>
                                    </button>
                                  </td>;
                                })}
                                <td className="mono">{impDiff === null ? '—' : signed(impDiff)}</td>
                              </tr>;
                            })}
                          </tbody>
                          <tfoot><tr>
                            <td colSpan={4}>
                              <div className="team-match-summary" aria-label="本圈比數，我方在左、對手在右">
                                <span className="muted">{playerMatchScore?.split ? 'IMP 淨差' : 'IMP 合計'}</span>
                                <button type="button" className="contract-link mono" aria-label="查看本圈雙方 Butler IMP" popoverTarget="player-butler-summary" onClick={e => positionDetail(e.currentTarget)}>{teamPlayerRows.some(row => row.impDiff !== null) ? playerMatchScore?.split ? `${signed(playerMatchScore.a === playerId ? playerMatchScore.marginA : playerMatchScore.marginB)} : ${signed(playerMatchScore.a === playerId ? playerMatchScore.marginB : playerMatchScore.marginA)}` : `${playerImpFor} : ${playerImpAgainst}` : '— : —'}</button>
                              <button type="button" className="contract-link" popoverTarget="player-vp-scale" onClick={e => positionDetail(e.currentTarget)}>換算 VP</button>
                                <button type="button" className="contract-link mono" aria-label="查看雙方累積 VP" popoverTarget="player-cumulative-vp" onClick={e => positionDetail(e.currentTarget)}>{number(playerMatchVp)} : {number(opponentMatchVp)}</button>
                              </div>
                              <div key={`${playerId}-${playerRound}-cumulative`} id="player-cumulative-vp" popover="auto" className="player-detail-popover">
                                <strong>截至第 {playerRound} 圈 · 累積 VP</strong>
                                {[playerId, playerMatch ? (playerMatch.ns === playerId ? playerMatch.ew : playerMatch.ns) : undefined].map((id, index) => <div key={index}>
                                  {index === 0 ? '我方' : '對手'} · {id ? name(id) : '—'}：<span className="mono">{number(cumulativePlayerStandings.find(s => s.id === id)?.score ?? null)} VP</span>
                                </div>)}
                                <small className="muted">僅計入已完成對戰的 VP。</small>
                              </div>
                              <div key={`${playerId}-${playerRound}-butler`} id="player-butler-summary" popover="auto" className="player-detail-popover">
                                <strong>第 {playerRound} 圈 · Butler IMP 合計</strong>
                                <div>我方 · {name(playerId!)}：<span className="butler-total">{playerButlers.length ? signed(playerButlerTotal) : '—'}</span></div>
                                <div>對手 · {playerMatch ? name(playerMatch.ns === playerId ? playerMatch.ew : playerMatch.ns) : '—'}：<span className="butler-total">{playerButlers.length ? signed(opponentButlerTotal) : '—'}</span></div>
                                <small className="muted">加總本圈兩室已收的有效成績；取消與平均分不計入。</small>
                              </div>
                              <div key={`${playerId}-${playerRound}-${playerVpBoards}`} id="player-vp-scale" popover="auto" className="player-detail-popover vp-scale-popover">
                                <strong>第 {playerRound} 圈 · {playerVpBoards} 牌 VP 換算表</strong>
                                <p>WBF 20–0 · 依原訂牌數換算</p>
                                <p>{playerMatchVp === null ? '成績未齊，尚未換算 VP' : `我方 ${signed(playerImpTotal)} IMP → ${number(playerMatchVp)} VP`}</p>
                                {playerVpScale.length ? <div className="vp-scale-scroll">
                                  <table aria-label={`${playerVpBoards} 牌 VP 換算表`}>
                                    <thead><tr><th>IMP 差</th><th>勝方 VP</th><th>負方 VP</th></tr></thead>
                                    <tbody>{playerVpScale.map((entry, index) => <tr key={entry.margin} className={playerMatchVp !== null && Math.min(Math.abs(playerImpTotal), playerVpScale.length - 1) === entry.margin ? 'vp-scale-current' : undefined}>
                                      <td>{entry.margin}{index === playerVpScale.length - 1 ? '+' : ''}</td>
                                      <td>{number(entry.winner)}</td><td>{number(entry.loser)}</td>
                                    </tr>)}</tbody>
                                  </table>
                                </div> : <p>本圈沒有可計分的牌。</p>}
                              </div>
                            </td>
                          </tr></tfoot>
                        </table>}
                        {Boolean(event.kind !== 'teams') && <table>
                          <thead>
                            <tr>
                              {event.kind !== 'teams' && <th aria-sort={playerSort === 'round' ? 'ascending' : 'none'}>
                                <button
                                  className="contract-link"
                                  onClick={() => setPlayerSort('round')}
                                >
                                  桌次
                                </button>
                              </th>}
                              <th aria-sort={playerSort === 'board' ? 'ascending' : 'none'}>
                                <button
                                  className="contract-link"
                                  onClick={() => setPlayerSort('board')}
                                >
                                  牌號
                                </button>
                              </th>
                              <th>{event.kind === 'teams' ? '房間' : '方向'}</th>
                              {event.kind !== 'teams' && <th aria-sort={playerSort === 'opponent' ? 'ascending' : 'none'}>
                                <button
                                  className="contract-link"
                                  onClick={() => setPlayerSort('opponent')}
                                >
                                  對手
                                </button>
                              </th>}
                              <th>合約</th>
                              <th>己方原始分</th>
                              {event.kind === 'pairs' && <th>{pairMethod === 'mp' ? 'MP%' : 'IMP'}</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {playerRows.map(({ a, b, shaded }) => {
                              const r = event.results[resultKey(a.id, b)],
                                ns = a.ns === (person || event.participants[0].id),
                                mp = event.projection.pairScores[resultKey(a.id, b)],
                                value = mp ? (ns ? mp.ns : mp.ew) : null;
                              const scores = event.assignments
                                .filter((other) => other.boards.includes(b))
                                .map((other) => event.results[resultKey(other.id, b)])
                                .filter((result) => result && result.status !== 'cancelled')
                                .map((result) => result.nsScore);
                              const average = scores.length
                                ? (scores.reduce((sum, score) => sum + score, 0) / scores.length) *
                                  (ns ? 1 : -1)
                                : null;
                              const popupId = `player-${a.id}-${b}`;
                              const openBoard = () => {
                                setSelectedResult('');
                                setTravellerSide(ns ? 'ns' : 'ew');
                                setBoard(b);
                                setTab('boards');
                              };
                              return (
                                <tr
                                  key={resultKey(a.id, b)}
                                  className={shaded ? 'even-round' : undefined}
                                >
                                  {event.kind !== 'teams' && <td>
                                    <button
                                      className="contract-link"
                                      onClick={() => {
                                        setRound(a.round);
                                        setTab('rounds');
                                      }}
                                    >
                                      <strong className="player-round">R{a.round}</strong>
                                      <small className="muted">/{a.table}</small>
                                    </button>
                                  </td>}
                                  <td>
                                    <button className="text-button" onClick={openBoard}>
                                      {b}
                                    </button>
                                  </td>
                                  <td>{event.kind === 'teams' ? (a.room === 'open' ? '公開' : '關閉') : (ns ? 'NS' : 'EW')}</td>
                                  {event.kind !== 'teams' && <td>
                                    <span className="opponent-name">
                                      {name(ns ? a.ew : a.ns)}{' '}
                                      <small className="muted">
                                        {participantNumber((ns ? a.ew : a.ns), event.kind)}
                                      </small>
                                    </span>
                                    <button
                                      className="opponent-number contract-link"
                                      popoverTarget={`${popupId}-opponent`}
                                      onClick={(e) => positionDetail(e.currentTarget)}
                                    >
                                      {participantNumber((ns ? a.ew : a.ns), event.kind)}
                                    </button>
                                    <div
                                      id={`${popupId}-opponent`}
                                      popover="auto"
                                      className="player-detail-popover"
                                    >
                                      對手：{participantNumber((ns ? a.ew : a.ns), event.kind)} ·{' '}
                                      {name(ns ? a.ew : a.ns)}
                                    </div>
                                  </td>}
                                  <td>
                                    <button
                                      type="button"
                                      className="contract-link"
                                      aria-label={`查看牌號 ${b} 的逐副成績`}
                                      onClick={openBoard}
                                    >
                                      <Contract result={r} />
                                    </button>
                                  </td>
                                  <td className="mono">
                                    <button
                                      className="player-raw-score contract-link"
                                      popoverTarget={`${popupId}-average`}
                                      onClick={(e) => positionDetail(e.currentTarget)}
                                    >
                                      {r && r.status !== 'cancelled'
                                        ? signed(r.nsScore * (ns ? 1 : -1))
                                        : '—'}
                                    </button>
                                    <div
                                      id={`${popupId}-average`}
                                      popover="auto"
                                      className="player-detail-popover"
                                    >
                                      牌號 {b} · {ns ? 'NS' : 'EW'} 平均分{' '}
                                      {average === null
                                        ? '—'
                                        : `${average >= 0 ? '+' : ''}${number(average)}`}
                                      （{scores.length} 桌有效結果）
                                    </div>
                                  </td>
                                  {event.kind === 'pairs' && <td
                                    className={
                                      event.kind === 'pairs'
                                        ? `player-points ${pairTone(value, mp?.top ?? 0, pairMethod)}`
                                        : undefined
                                    }
                                  >
                                    <span className="player-points-value">
                                      {value !== null && mp
                                          ? pairValue(value, mp.top, pairMethod)
                                          : '—'}
                                    </span>
                                  </td>}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>}
                      </div>
                    </section>
                  )}
                  {tab === 'admin' && admin && (
                    <AdminPanel
                      key={id}
                      eventId={id}
                      onSaved={async (message) => {
                        setNotice(message);
                        await refresh();
                      }}
                      onDeleted={async () => {
                        requestGeneration.current++;
                        setEvent(null);
                        location.assign(event.parentEventId ? `/?competition=${encodeURIComponent(event.parentEventId)}` : '/');
                        setTab('standings');
                        setNotice('賽事已刪除。');
                      }}
                    />
                  )}
                  <footer className="page-footer">
                    <span>
                      VALET <span>／</span> 由臺灣大學橋藝社自主研發
                    </span>
                    <span>
                      {event.kind === 'teams' ? 'IMP · WBF VP' : methodNames[pairMethod]}　♠ ♥ ♦ ♣
                    </span>
                  </footer>
                </>
              )}
            </>
          )}
        </main>
      </div>
      {showLogin && (
        <Modal title="裁判／賽務登入" onClose={() => setShowLogin(false)}>
          <p className="muted">
            賽務可更正、取消及判罰；裁判另可建立、刪除、匯入匯出賽事及查看操作紀錄。
          </p>
          {!configured && (
            <div className="alert">
              尚未設定登入。請依 README 設定 ADMIN_PASSWORD 與 SESSION_SECRET；本機可執行 npm run
              dev:local。
            </div>
          )}
          <form onSubmit={login}>
            <label className="field">
              裁判／賽務密碼
              <span className="password-input">
                <input
                  autoFocus
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
            {loginError && (
              <p className="error-text" role="alert">
                {loginError}
              </p>
            )}
            <button disabled={!configured || loggingIn} className="button primary full">
              {loggingIn ? '登入中…' : '登入後台'}
            </button>
          </form>
        </Modal>
      )}

    </div>
  );
}
function Stat({
  label,
  value,
  suffix,
  icon,
  progress,
  popoverTarget,
  onClick,
  detail,
}: {
  label: string;
  value: number | string;
  suffix: string;
  icon?: React.ReactNode;
  progress?: number;
  popoverTarget?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  detail?: string;
}) {
  const content = (
    <>
      <div className="stat-top">
        <span>{label}</span>
        {icon ?? <Activity size={18} />}
      </div>
      <div className="stat-value">
        {value}
        <small>{suffix}</small>
      </div>
      {detail ? (
        <div className="stat-detail">{detail}</div>
      ) : progress !== undefined ? (
        <div className="progress-track">
          <span style={{ width: `${progress * 100}%` }} />
        </div>
      ) : (
        <div className="stat-line" />
      )}
    </>
  );
  return popoverTarget ? (
    <button className="stat-card interactive-stat" popoverTarget={popoverTarget} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="stat-card">{content}</div>
  );
}
function RoundSelect({
  count,
  round,
  setRound,
}: {
  count: number;
  round: number;
  setRound: (n: number) => void;
}) {
  return (
    <label className="round-select">
      輪次{' '}
      <select
        aria-label="選擇輪次"
        value={round}
        onChange={(e) => setRound(Number(e.target.value))}
      >
        {Array.from({ length: count }, (_, i) => (
          <option key={i} value={i + 1}>
            第 {i + 1} 輪
          </option>
        ))}
      </select>
    </label>
  );
}
function DealDiagram({ board }: { board: PublicEvent['boards'][number] }) {
  if (!hasDeal(board) || board.deal.N.length !== 13)
    return (
      <div className="hidden-deal">
        <LockKeyhole size={32} />
        <strong>{'deal' in board ? '尚未匯入牌型' : '牌型尚未公開'}</strong>
        <span>逐副合約與成績可在下方的單副成績表查詢。</span>
      </div>
    );
  return (
    <div className="deal-diagram">
      {(['N', 'W', 'E', 'S'] as Seat[]).map((seat) => (
        <div className={`hand hand-${seat}`} key={seat}>
          <div className="seat-label">
            {seat} <span>{seatNames[seat]}</span>
          </div>
          {['S', 'H', 'D', 'C'].map((s) => (
            <div className="suit-line" key={s}>
              <b className={s === 'H' || s === 'D' ? 'red' : ''}>{suitSymbols[s]}</b>
              <span>
                {board.deal[seat]
                  .filter((c) => c[0] === s)
                  .map((c) => c[1])
                  .sort((a, b) => 'AKQJT98765432'.indexOf(a) - 'AKQJT98765432'.indexOf(b))
                  .join(' ') || '—'}
              </span>
            </div>
          ))}
        </div>
      ))}
      <div className="deal-center">
        <span>BOARD</span>
        <strong>{board.number}</strong>
        <small>{board.dealer} DEALER</small>
      </div>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="關閉" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function CreateDialog({
  onClose,
  onCreated,
  competition,
}: {
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
  competition?: import('@/lib/model').CompetitionInfo;
}) {
  const [kind, setKind] = useState<Kind>('teams'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [method, setMethod] = useState('mp');
  const [gameMode, setGameMode] = useState<'bridge' | 'minibridge'>('bridge');
  const [staged, setStaged] = useState(false);
  const [eventDate, setEventDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }));
  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = new FormData(ev.currentTarget);
    setBusy(true);
    setError('');
    try {
      const stage = {
          kind,
          gameMode,
          pairMethod: kind === 'pairs' ? method : 'mp',
          trim: kind === 'pairs' && method !== 'mp' ? form.get('trim') : 'none',
          name: form.get('name'),
          prefix: competition ? '' : form.get('prefix'),
          date: competition?.date ?? form.get('date'),
          venue: competition?.venue ?? form.get('venue'),
          ...(!competition && staged ? { firstStageName: form.get('firstStageName') } : {}),
          rounds: Number(form.get('rounds')),
          boardsPerRound: Number(form.get('boardsPerRound')),
          names: String(form.get('names'))
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
        };
      const res = await api<{ id: string }>(competition ? `/api/competitions/${competition.id}/stages` : '/api/events', {
        method: 'POST',
        body: JSON.stringify(competition ? { stage, revision: competition.revision, ...(!competition.hasStages ? { firstStageName: form.get('firstStageName') } : {}) } : stage),
      });
      await onCreated(res.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={competition ? '新增賽段' : '建立新賽事'} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">橋牌模式<select value={gameMode} onChange={e => setGameMode(e.target.value as 'bridge' | 'minibridge')}><option value="bridge">一般橋牌</option><option value="minibridge">MiniBridge 迷你橋牌</option></select></label>
        {gameMode === 'minibridge' && <p>五種花色 × 一線／成局，共 10 種合約；無身價、不加倍。</p>}
        {!competition && <label className="stage-mode"><input type="checkbox" checked={staged} onChange={e => setStaged(e.target.checked)} /> 設立賽段</label>}
        {((!competition && staged) || (competition && !competition.hasStages)) && <label className="field">{competition ? '原有成績的賽段名稱' : '第一賽段名稱'}<input name="firstStageName" required maxLength={80} placeholder="例如：預賽" /></label>}
        {competition && <p>{competition.name} · {competition.date} · {competition.venue || '未填地點'}<br />此賽段使用獨立名單、賽制與成績。</p>}
        <div className="segmented">
          <button
            type="button"
            className={kind === 'teams' ? 'selected' : ''}
            onClick={() => setKind('teams')}
          >
            隊制賽 · IMP / VP
          </button>
          <button
            type="button"
            className={kind === 'pairs' ? 'selected' : ''}
            onClick={() => setKind('pairs')}
          >
            雙人賽
          </button>
        </div>
        {kind === 'pairs' && (
          <div className="form-grid">
            <div className="field">
              <div className="scoring-label"><label htmlFor="create-scoring-mode">計分模式</label><button type="button" className="scoring-info-button" aria-label="計分模式說明" popoverTarget="create-scoring-help"><Info size={16} /></button></div>
              <select
                id="create-scoring-mode"
                aria-label="計分模式"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                <option value="mp">MP 百分比</option>
                <option value="crossimp">CrossIMP</option>
                <option value="butler">ButlerIMP</option>
              </select>
            </div>
            <label className="field">
              <span className="scoring-label">去頭去尾</span>
              <select name="trim" disabled={method === 'mp'} defaultValue="none">
                <option value="none">不去除</option>
                <option value="one">最高、最低各去一筆</option>
                <option value="ten-percent">最高、最低各去 10%（向下取整）</option>
              </select>
            </label>
            <div id="create-scoring-help" popover="auto" className="scoring-help" role="dialog" aria-label="計分模式說明">
              <div className="scoring-help-heading"><strong>計分模式說明</strong><button type="button" className="icon-button" aria-label="關閉計分模式說明" popoverTarget="create-scoring-help" popoverTargetAction="hide"><X size={16} /></button></div>
              <p><strong>MP：</strong>比較各桌成績，以百分比計分。</p>
              <p><strong>Butler：</strong>樣本算術平均取最近 10 分（恰為 5 時遠離零），各桌與此基準分比較 IMP。</p>
              <p><strong>CrossIMP：</strong>每桌對其他桌的 IMP 取平均。</p>
              <p>去尾僅影響比較樣本，所有有效桌次仍計分；樣本少於三筆不去尾。IMP 排名採累計總分。</p>
            </div>
          </div>
        )}
        <label className="field">
          {competition ? '新賽段名稱' : '賽事名稱（不含前綴）'}
          <input
            name="name"
            required
            minLength={2}
            maxLength={80}
            placeholder="例如：秋季俱樂部邀請賽"
          />
        </label>
        {!competition && <label className="field">
          比賽前綴（選填）
          <input name="prefix" maxLength={80} placeholder="例如：臺灣大學橋藝社 114-1" />
        </label>}
        <div className="form-grid create-details-grid">
          {!competition && <><div className="field">
            <span>日期</span>
            <input name="date" type="hidden" value={eventDate} />
            <EventCalendar dates={[]} value={eventDate} onChange={setEventDate} unrestricted />
          </div>
          <label className="field">
            地點
            <input name="venue" maxLength={80} placeholder="比賽地點" />
          </label></>}
          <label className="field">
            輪數
            <input name="rounds" type="number" min={1} max={15} defaultValue={3} required />
          </label>
          <label className="field">
            每輪牌數
            <input
              name="boardsPerRound"
              type="number"
              min={1}
              max={32}
              defaultValue={kind === 'teams' ? 8 : 2}
              key={kind}
              required
            />
          </label>
        </div>
        <label className="field">
          {kind === 'teams' ? '隊伍名稱' : '搭檔名稱'}（一行一組，至少四組）
          <textarea
            name="names"
            rows={5}
            required
            placeholder={
              kind === 'teams'
                ? '臺北隊\n新竹隊\n臺中隊\n高雄隊'
                : '林冠宇 / 陳思妤\n張哲維 / 王品涵\n李柏翰 / 黃詠晴\n吳承恩 / 劉芷瑜'
            }
          />
        </label>
        <p className="footnote">
          預設建立固定循環對戰，各桌每輪打相同牌組。雙人賽需備妥重複牌組，或在收分前匯入自己的賽程編排。排名同分並列。
        </p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={busy}>
          {busy ? '建立中…' : competition ? '建立賽段與賽程' : '建立賽事與賽程'}
        </button>
      </form>
    </Modal>
  );
}
function RoundStateFields({ event }: { event: PublicEvent }) {
  const progress = roundProgress(event);
  const [selectedRound, setSelectedRound] = useState(progress.round);
  const complete = allRoundsComplete(event) || event.status === 'finished';
  const selectedProgress = roundProgress({ ...event, currentRound: selectedRound });
  const collected = selectedRound > 0 && selectedProgress.expected > 0 && selectedProgress.received === selectedProgress.expected;
  return <div className="form-grid">
    <label className="field">目前圈數
      <select name="round" value={selectedRound} onChange={e => setSelectedRound(Number(e.target.value))}>
        <option value="0">尚未開始</option>
        {Array.from({ length: event.rounds }, (_, i) => <option key={i} value={i + 1} disabled={!event.assignments.some(a => a.round === i + 1)}>第 {i + 1} 圈</option>)}
      </select>
    </label>
    <label className="field">進度狀態
      {selectedRound === 0 || complete || collected ? <>
        <select disabled value="automatic"><option value="automatic">{complete ? '賽事已結束' : selectedRound === 0 ? '尚未開始' : '圈間休息'}</option></select>
        <input type="hidden" name="phase" value={selectedRound === 0 ? 'playing' : 'break'} />
      </> : <select name="phase" key={selectedRound} defaultValue={selectedRound === progress.round ? event.roundPhase ?? 'playing' : 'playing'}>
        <option value="playing">進行中</option><option value="break">圈間休息</option>
      </select>}
    </label>
  </div>;
}

function AdminPanel({
  eventId,
  onSaved,
  onDeleted,
}: {
  eventId: string;
  onSaved: (s: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [event, setEvent] = useState<AdminEvent | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [section, setSection] = useState('score');
  const [assignment, setAssignment] = useState(''),
    [board, setBoard] = useState(1),
    [round, setRound] = useState(1),
    [reason, setReason] = useState('現場收分');
  const [input, setInput] = useState<ResultInput>({
    assignmentId: '',
    board: 1,
    level: 3,
    strain: 'NT',
    declarer: 'N',
    doubled: 1,
    tricks: 9,
    lead: '',
  });
  const [importType, setImportType] = useState('results'),
    [text, setText] = useState(''),
    [preview, setPreview] = useState('');
  const [deleteName, setDeleteName] = useState('');
  const [timingRound, setTimingRound] = useState(1);
  const load = useCallback(async () => {
    const e = await api<AdminEvent>(`/api/admin/events/${eventId}`, { cache: 'no-store' });
    setEvent(e);
    return e;
  }, [eventId]);
  useEffect(() => {
    let alive = true;
    setEvent(null);
    load()
      .then((e) => {
        if (alive) {
          setRound(e.assignments[0].round);
          setTimingRound(e.currentRound || 1);
          setAssignment(e.assignments[0].id);
          setBoard(e.assignments[0].boards[0]);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, [load]);
  useEffect(() => {
    const r = event?.results[resultKey(assignment, board)];
    setInput(
      r && r.status !== 'cancelled' && r.status !== 'average'
        ? {
            assignmentId: r.assignmentId,
            board: r.board,
            level: r.level,
            miniBridge: r.miniBridge,
            strain: r.strain,
            declarer: r.declarer,
            doubled: r.doubled,
            tricks: r.tricks,
            lead: r.lead,
          }
        : {
            assignmentId: assignment,
            board,
            level: 3,
            miniBridge: event?.gameMode === 'minibridge',
            strain: 'NT',
            declarer: 'N',
            doubled: 1,
            tricks: 9,
            lead: '',
          },
    );
    setReason(r ? '更正成績' : '現場收分');
  }, [assignment, board, event?.revision]);
  async function save(payload: Record<string, unknown>) {
    if (!event) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/events/${eventId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...payload,
          revision: event.revision,
          requestId: crypto.randomUUID(),
          reason: payload.reason ?? reason,
        }),
      });
      const updated = await load();
      if (!updated.assignments.some((a) => a.id === assignment && a.boards.includes(board))) {
        const first = updated.assignments.find((a) => a.round === round) ?? updated.assignments[0];
        setRound(first.round);
        setAssignment(first.id);
        setBoard(first.boards[0]);
      }
      await onSaved('已儲存並重新計分。觀眾頁面每 30 秒自動更新，也可手動更新。');
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function previewImport() {
    if (!event) return;
    setError('');
    setPreview('');
    try {
      if (importType === 'results') {
        const rows = parseResultsCsv(text);
        for (const r of rows) {
          const a = event.assignments.find((a) => a.id === r.assignmentId);
          if (!a?.boards.includes(r.board))
            throw new Error(`桌次 ${r.assignmentId}／牌 ${r.board} 不在賽程內`);
        }
        setPreview(
          `共 ${rows.length} 筆成績，將新增或覆寫相同桌次／牌號。前 5 筆：\n${rows
            .slice(0, 5)
            .map(
              (r) =>
                `${r.assignmentId} · B${r.board} · ${displayContract(r)} ${r.declarer} ${resultText(r)}`,
            )
            .join('\n')}`,
        );
      } else if (importType === 'pbn') {
        const boards = parsePbn(text);
        setPreview(
          `共 ${boards.length} 副完整牌型：${boards.map((b) => b.number).join(', ')}。需與全場牌號一致，且尚未收分。`,
        );
      } else {
        const rows = parseMovement(text, event as BridgeEvent);
        setPreview(
          `共 ${rows.length} 組桌次安排；匯入所列輪次，已收分的輪次不得改動。首次匯入會取代尚未收分的預設賽程。`,
        );
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!event) return <section className="panel empty">{error || '載入賽事資料中…'}</section>;
  const selected = event.assignments.find((a) => a.id === assignment),
    existing = event.results[resultKey(assignment, board)];
  const name = (id: string) => event.participants.find((p) => p.id === id)?.name ?? id;
  return (
    <section className="panel admin-panel">
      <div className="panel-heading admin-panel-heading">
          <h3>
            {event.canDirect ? '裁判後台' : '賽務後台'}
          </h3>
        <span className="badge admin-version">版本 {event.revision}</span>
        <p className="admin-panel-description">
          原始結果、排名與更正紀錄一併儲存。
        </p>
      </div>
      <div className="admin-tabs">
        {[
          ['score', '收分／更正'],
          ...(event.canDirect ? [['import', '匯入／匯出']] : []),
          ['publish', event.canDirect ? '圈次與發布設定' : '賽事設定'],
          ['penalty', '判罰調整'],
          ...(event.canDirect ? [['audit', '操作紀錄']] : []),
          ...(event.canDirect && event.kind === 'pairs' ? [['club', '俱樂部收分']] : []),
        ].map(([k, v]) => (
          <button
            key={k}
            className={section === k ? 'selected' : ''}
            onClick={() => {
              setSection(k);
              setError('');
            }}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="admin-content">
        {section === 'club' && event.canDirect && event.kind === 'pairs' && <ClubAdmin event={event} reload={load} />}
        {section === 'publish' && event.canDirect && (
          <>
            <form className="round-settings-form" key={`board-number-${event.maxBoardNumber}`} onSubmit={e => {
              e.preventDefault(); const data = new FormData(e.currentTarget);
              void save({ action: 'settings', status: event.status, maxBoardNumber: Number(data.get('maxBoardNumber')), reason: '設定循環顯示最大牌號' });
            }}>
              <label className="field">最大牌號<input name="maxBoardNumber" type="number" min="1" max="128" required defaultValue={event.maxBoardNumber ?? 32} /></label>
              <p className="footnote">超過後從牌號 1 重新顯示，各圈成績仍獨立保存。</p>
              <button className="button subtle" disabled={busy}>儲存最大牌號</button>
            </form>

            <form
              className="round-settings-form"
              key={`current-${event.currentRound}-${event.roundPhase}`}
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                void save({
                  action: 'round-control',
                  round: Number(form.get('round')),
                  phase: String(form.get('phase')),
                  reason: '裁判指定目前圈數與比賽進度',
                });
              }}
            >
              <h4>目前打到哪一圈</h4>
              <RoundStateFields key={event.revision} event={event} />
              <p className="footnote">圈數會隨收分進度往前更新；該圈收齊後進入圈間休息，全部收齊後顯示賽事已結束。</p>
              <button className="button primary" disabled={busy || event.status === 'finished'}>
                儲存目前圈數
              </button>
              {event.status === 'finished' && (
                <p className="footnote">賽事已結束；重新開放後才可調整目前圈數。</p>
              )}
            </form>
            <form
              className="round-settings-form"
              key={`timing-${timingRound}-${JSON.stringify(event.roundTimes?.[timingRound])}`}
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                const start = String(form.get('startAt') ?? ''),
                  end = String(form.get('endAt') ?? '');
                void save({
                  action: 'round-timing',
                  round: timingRound,
                  startAt: start ? new Date(`${form.get("startDate")}T${start}+08:00`).toISOString() : null,
                  endAt: end ? new Date(`${form.get("endDate")}T${end}+08:00`).toISOString() : null,
                  reason: `設定第 ${timingRound} 圈時間區間`,
                });
              }}
            >
              <h4>各圈時間區間</h4>
              <label className="field">
                設定圈次
                <select
                  value={timingRound}
                  onChange={(e) => setTimingRound(Number(e.target.value))}
                >
                  {Array.from({ length: event.rounds }, (_, i) => (
                    <option key={i} value={i + 1}>
                      第 {i + 1} 圈
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-grid">
                <label className="field">
                  開始時間（臺灣時間）
                  <input type="date" name="startDate" aria-label="開始日期" required
                    defaultValue={taipeiDateInput(event.roundTimes?.[timingRound]?.startAt).slice(0, 10) || event.date} />
                  <input type="time" name="startAt" aria-label="開始時間"
                    defaultValue={taipeiDateInput(event.roundTimes?.[timingRound]?.startAt).slice(11, 16)} />
                </label>
                <label className="field">
                  預定結束時間（臺灣時間）
                  <input type="date" name="endDate" aria-label="結束日期" required
                    defaultValue={taipeiDateInput(event.roundTimes?.[timingRound]?.endAt).slice(0, 10) || event.date} />
                  <input type="time" name="endAt" aria-label="結束時間"
                    defaultValue={taipeiDateInput(event.roundTimes?.[timingRound]?.endAt).slice(11, 16)} />
                </label>
              </div>
              <p className="footnote">
                開始與結束需一起填寫；兩個時間欄清空後儲存，可清除本圈時間。時間不會自動切換圈次。
              </p>
              <button className="button subtle" disabled={busy}>
                儲存時間區間
              </button>
            </form>
          </>
        )}
        {error && (
          <div className="alert error" role="alert">
            {error}
            <button
              onClick={() => {
                load()
                  .then(() => setError(''))
                  .catch((e) => setError(e.message));
              }}
            >
              重新載入
            </button>
          </div>
        )}
        {section === 'score' && (
          <>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await save({
                action: 'results',
                results: [{ ...input, assignmentId: assignment, board }],
              });
            }}
          >
            <div className="form-grid">
              <label className="field">
                輪次
                <select
                  value={round}
                  onChange={(e) => {
                    const r = Number(e.target.value),
                      a = event.assignments.find((a) => a.round === r)!;
                    setRound(r);
                    setAssignment(a.id);
                    setBoard(a.boards[0]);
                  }}
                >
                  {[...new Set(event.assignments.map((a) => a.round))]
                    .sort((a, b) => a - b)
                    .map((r) => (
                      <option value={r} key={r}>
                        {r}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                桌次
                <select
                  value={assignment}
                  onChange={(e) => {
                    const a = event.assignments.find((a) => a.id === e.target.value)!;
                    setAssignment(a.id);
                    setBoard(a.boards[0]);
                  }}
                >
                  {event.assignments
                    .filter((a) => a.round === round)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.table}{event.kind === 'teams' ? a.room === 'open' ? ' · 開室' : ' · 閉室' : ''}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <div className="seating-note">
              {(['NS', 'EW'] as const).map((side) => {
                const id = selected?.[side === 'NS' ? 'ns' : 'ew'];
                const standing = event.projection.standings.find((s) => s.id === id);
                const method = event.pairMethod ?? 'mp';
                const score = standing?.score;
                const summary = id ? `${participantNumber(id, event.kind)} / ${score == null ? '—' : `${score >= 0 && method !== 'mp' ? '+' : ''}${number(score, method === 'butler' && Number.isInteger(score) ? 0 : 2)}${event.kind === 'teams' ? ' VP' : method === 'mp' ? '%' : ' IMP'}`}${standing ? ` / #${standing.rank}` : ''}` : '—';
                return <div className="seating-participant" key={side}>
                  <div className="seating-name" title={id ? name(id) : ''}>
                    <b>{side}</b><span>{id ? name(id) : '—'}</span>
                  </div>
                  <small title={summary}>{summary}</small>
                </div>;
              })}
            </div>
            {event.kind === 'teams' && selected && <fieldset key={`${selected.id}-${event.revision}`}>
              <legend>本桌上場賽員</legend>
              <div className="form-grid">
                {(['N', 'E', 'S', 'W'] as const).map(seat => {
                  const team = event.participants.find(p => p.id === (seat === 'N' || seat === 'S' ? selected.ns : selected.ew));
                  return <label className="field" key={seat}>{({N:'北',E:'東',S:'南',W:'西'})[seat]} · {team?.name}
                    <select name={`seat-${seat}`} defaultValue={selected.playerNames?.[seat] ?? ''}>
                      <option value="">尚未指定</option>
                      {team?.players.split('、').filter(Boolean).map(n => <option key={n}>{n}</option>)}
                    </select>
                  </label>;
                })}
              </div>
              <button type="button" className="button subtle" disabled={busy} onClick={e => {
                const data = new FormData(e.currentTarget.form!);
                void save({ action: 'table-lineup', assignmentId: selected.id, playerNames: Object.fromEntries(['N','E','S','W'].map(s => [s, String(data.get(`seat-${s}`) ?? '')])), reason: '更新本桌東南西北姓名' });
              }}>儲存上場名單</button>
            </fieldset>}
            <div className="form-grid four">
              <label className="field">
                牌號
                <select value={board} onChange={(e) => setBoard(Number(e.target.value))}>
                  {selected?.boards.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </label>
              {event.gameMode === 'minibridge' ? <MiniContractFields value={input} onChange={setInput} /> : <>
              <label className="field">
                線位
                <select
                  value={input.level}
                  onChange={(e) => {
                    const level = Number(e.target.value);
                    setInput({ ...input, level, tricks: level ? level + 6 : 0, doubled: 1 });
                  }}
                >
                  {Array.from({ length: 8 }, (_, i) => (
                    <option value={i} key={i}>
                      {i || 'Pass out'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                合約花色
                <select
                  disabled={!input.level}
                  value={input.strain}
                  onChange={(e) =>
                    setInput({ ...input, strain: e.target.value as ResultInput['strain'] })
                  }
                >
                  {['C', 'D', 'H', 'S', 'NT'].map((s) => (
                    <option value={s} key={s}>
                      {suitSymbols[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                加倍
                <select
                  disabled={!input.level}
                  value={input.doubled}
                  onChange={(e) =>
                    setInput({ ...input, doubled: Number(e.target.value) as 1 | 2 | 4 })
                  }
                >
                  <option value={1}>未加倍</option>
                  <option value={2}>X</option>
                  <option value={4}>XX</option>
                </select>
              </label>
              </>}
              <label className="field">
                莊家
                <select
                  disabled={!input.level}
                  value={input.declarer}
                  onChange={(e) => setInput({ ...input, declarer: e.target.value as Seat })}
                >
                  {(['N', 'E', 'S', 'W'] as Seat[]).map((s) => (
                    <option key={s} value={s}>
                      {seatNames[s]} {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                實得墩數
                <input
                  type="number"
                  min={0}
                  max={13}
                  required
                  disabled={!input.level}
                  value={input.tricks}
                  onChange={(e) => setInput({ ...input, tricks: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                首攻（選填）
                <input
                  maxLength={4}
                  value={input.lead}
                  placeholder="例如 SA"
                  onChange={(e) => setInput({ ...input, lead: e.target.value.toUpperCase() })}
                />
              </label>
              <div className="score-preview">
                <span>NS 原始分</span>
                <strong>
                  {signed(
                    contractScore(
                      input,
                      event.boards.find((b) => b.number === board)?.vulnerability ?? 'None',
                      event.gameMode === 'minibridge',
                    ),
                  )}
                </strong>
                <small>
                  {vulNames[event.boards.find((b) => b.number === board)?.vulnerability ?? 'None']}
                </small>
              </div>
            </div>
            <label className="field">
              {existing ? '更正原因' : '紀錄說明'}
              <input
                required
                minLength={2}
                maxLength={200}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {existing && (
              <p className="footnote">
                目前紀錄：{displayContract(existing)} {existing.declarer} {resultText(existing)}，NS{' '}
                {signed(existing.nsScore)}。提交後會保留前後差異。
              </p>
            )}
            <div className="button-row score-actions">
            <button
              className="button score-save"
              disabled={busy || event.status === 'finished' || !!existing?.split || existing?.status === 'cancelled'}
            >
              <Check size={16} />
              {busy ? '儲存中…' : existing ? '儲存更正並重算' : '提交成績'}
            </button>
              <button
                type="button"
                className={existing?.status === 'cancelled' ? 'button subtle' : 'button danger'}
                disabled={busy || event.status === 'finished' || !!existing?.split || reason.trim().length < 2}
                onClick={() =>
                  save({
                    action: 'ruling',
                    assignmentId: assignment,
                    board,
                    cancelled: existing?.status !== 'cancelled',
                    ...(existing?.status === 'cancelled'
                      ? { result: { ...input, assignmentId: assignment, board } }
                      : {}),
                    reason,
                  })
                }
              >
                {existing?.status === 'cancelled' ? '恢復合約' : '取消此副'}
              </button>
            </div>
            {event.status === 'finished' && (
              <p className="footnote">賽事已結束；更正前請至發布設定重新開放。</p>
            )}
          </form>
            {event.canDirect && event.kind === 'teams' && existing && existing.status !== 'cancelled' && existing.status !== 'average' && selected && <SplitContractEditor
              key={assignment + ':' + board + ':' + event.revision} result={existing}
              names={{ ns: name(selected.ns), ew: name(selected.ew) }}
              vulnerability={event.boards.find(b => b.number === board)?.vulnerability ?? 'None'}
              miniBridge={event.gameMode === 'minibridge'} disabled={busy || event.status === 'finished'} save={save}
            />}
          </>
        )}
        {section === 'import' && event.canDirect && (
          <>
            {event.kind === 'teams' && <details className="panel">
              <summary>隊伍賽員名單</summary>
              {event.participants.map(p => <form key={`${p.id}-${event.revision}`} className="round-settings-form" onSubmit={e => {
                e.preventDefault(); const data = new FormData(e.currentTarget);
                void save({ action: 'team-roster', participantId: p.id, captain: String(data.get('captain')), players: String(data.get('players')).split(/[\n、]/).map(n => n.trim()).filter(Boolean), reason: '更新隊伍賽員名單' });
              }}>
                <h4>{participantNumber(p.id, event.kind)} · {p.name}</h4>
                <label className="field">隊長<input name="captain" defaultValue={p.captain ?? ''} /></label>
                <label className="field">賽員（每行一人）<textarea name="players" defaultValue={p.players.split('、').join('\n')} /></label>
                <button className="button subtle" disabled={busy}>儲存名單</button>
              </form>)}
            </details>}
            <section className="import-export-section">
              <h4>匯入資料</h4>
              <label className="field">
                匯入類型
                <select
                  value={importType}
                  onChange={(e) => {
                    setImportType(e.target.value);
                    setPreview('');
                    setText('');
                  }}
                >
                  <option value="results">成績 CSV</option>
                  <option value="pbn">完整牌型 PBN</option>
                  {event.kind === 'pairs' && <option value="movement">賽程編排 CSV</option>}
                </select>
              </label>
              <label className="field">
                選擇檔案（最多 200 KB）
                <input
                  type="file"
                  accept={importType === 'pbn' ? '.pbn' : '.csv'}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      if (file.size > 200000) {
                        setError('檔案超過 200 KB');
                        return;
                      }
                      setText(await file.text());
                      setPreview('');
                    }
                  }}
                />
              </label>
              <label className="field">
                或貼上內容
                <textarea
                  rows={8}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setPreview('');
                  }}
                  placeholder={
                    importType === 'results'
                      ? 'assignmentId,board,level,strain,doubled,declarer,tricks,lead\nr1m1o,1,3,NT,1,N,9,SA'
                      : importType === 'movement'
                        ? 'round,table,ns,ew,boards\n1,1,p1,p2,1;2'
                        : '[Board "1"]\n[Dealer "N"]\n[Vulnerable "None"]\n[Deal "N:..."]'
                  }
                />
              </label>
              <label className="field">
                匯入說明
                <input
                  minLength={2}
                  maxLength={200}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <div className="button-row">
                <button className="button subtle" onClick={previewImport}>
                  驗證並預覽
                </button>
                <button
                  className="button primary"
                  disabled={!preview || busy || reason.trim().length < 2}
                  onClick={async () => {
                    try {
                      const payload =
                        importType === 'results'
                          ? { action: 'results', results: parseResultsCsv(text) }
                          : importType === 'pbn'
                            ? { action: 'pbn', pbn: text }
                            : { action: 'movement', csv: text };
                      if (await save(payload)) {
                        setPreview('');
                        setText('');
                      }
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {busy ? '匯入中…' : '確認匯入'}
                </button>
              </div>
              {preview && <pre className="import-preview">{preview}</pre>}
              <p className="footnote">
                {importType === 'results'
                  ? '可下載下方成績 CSV，修改後匯入；請保留桌次識別碼（assignmentId）與牌號（board）。'
                  : importType === 'pbn'
                    ? '牌型僅能在尚未收分時替換。'
                    : '可逐圈匯入，每圈須包含完整賽程；已收分的圈次不可更改。'}
              </p>
            </section>
            <section className="import-export-section">
              <h4>匯出資料</h4>
              <p>下載目前賽事的成績、賽程或牌型。</p>
              <div className="button-row export-row">
                <button
                  className="button subtle"
                  onClick={() =>
                    download(
                      `${event.id}-results.csv`,
                      exportResultsCsv(event as BridgeEvent),
                      'text/csv',
                    )
                  }
                >
                  <ArrowDownToLine size={16} />
                  成績 CSV
                </button>
                {event.kind === 'pairs' && (
                  <button
                    className="button subtle"
                    onClick={() =>
                      download(
                        `${event.id}-movement.csv`,
                        exportMovement(event as BridgeEvent),
                        'text/csv',
                      )
                    }
                  >
                    <ArrowDownToLine size={16} />
                    賽程編排 CSV
                  </button>
                )}
                <button
                  className="button subtle"
                  onClick={() => download(`${event.id}.pbn`, exportPbn(event as BridgeEvent))}
                >
                  <ArrowDownToLine size={16} />
                  牌型 PBN
                </button>
                <button
                  className="button subtle"
                  onClick={() =>
                    download(
                      `${event.id}-backup.json`,
                      JSON.stringify(event, null, 2),
                      'application/json',
                    )
                  }
                >
                  <ArrowDownToLine size={16} />
                  賽事資料 JSON
                </button>
              </div>
            </section>
          </>
        )}
        {section === 'publish' && (
          <>
            {event.canDirect && (event.hasStages || event.parentEventId) && (
              <form
                className="event-identity-form"
                key={event.stageName}
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  void save({
                    action: 'settings',
                    status: event.status,
                    stageName: String(form.get('name')),
                    reason: '修改賽段名稱',
                  });
                }}
              >
                <h4>賽段資訊</h4>
                <label className="field">
                  賽段名稱
                  <input
                    name="name"
                    minLength={1}
                    maxLength={80}
                    required
                    defaultValue={event.stageName ?? event.name}
                  />
                </label>
                <button className="button subtle" disabled={busy}>
                  儲存賽段名稱
                </button>
              </form>
            )}
            <p className="footnote">名稱、日期與地點等共用資訊，請至 <a href={`/?competition=${encodeURIComponent(event.competition?.id ?? event.parentEventId ?? event.id)}`}>賽事主頁</a> 編輯。</p>
            {event.canDirect && (
              <>
                <h4>依牌組公開牌型</h4>
                <p>
                  每個按鈕一次公開或隱藏所列牌號的手牌、PBN 與雙夢家分析。牌組由 PBN
                  指定，未指定時依每圈牌數自動分組。已下載的牌型無法收回。
                </p>
                <div className="publication-grid">
                  {boardGroups(event.boards, event.boardsPerRound).map((group) => {
                    const b = group[0];
                    const published = group.every((item) => item.published ?? event.publishBoards);
                    const label = boardRange(group.map((item) => item.number));
                    return (
                      <button
                        key={b.number}
                        disabled={busy}
                        aria-pressed={published}
                        className={`button ${published ? 'primary' : 'subtle'}`}
                        onClick={() =>
                          save({
                            action: 'board-publication',
                            board: b.number,
                            published: !published,
                            reason: `牌 ${label} ${published ? '隱藏' : '公開'}牌型`,
                          })
                        }
                      >
                        {label} · {published ? '已公開' : '隱藏中'}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <form
              className="setting-row event-description-settings"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                void save({
                  action: 'settings',
                  status: event.status,
                  awardPlaces: Number(form.get('awardPlaces')),
                  awardDescription: String(form.get('awardDescription') ?? ''),
                  movementDescription: String(form.get('movementDescription') ?? ''),
                  reason: '設定給獎與賽程說明',
                });
              }}
            >
              <label className="field">
                給獎至第幾名（0 表示不給獎）
                <input
                  key={event.awardPlaces ?? 3}
                  name="awardPlaces"
                  type="number"
                  min="0"
                  max="32"
                  required
                  defaultValue={event.awardPlaces ?? 3}
                />
              </label>
              <label className="field">給獎內容
                <textarea name="awardDescription" maxLength={2000} defaultValue={event.awardDescription ?? ''} />
              </label>
              <label className="field">賽程編排說明
                <textarea name="movementDescription" maxLength={4000} defaultValue={event.movementDescription ?? ''} />
              </label>
              <button className="button subtle" disabled={busy}>
                儲存給獎與賽程說明
              </button>
            </form>
            <div className="setting-row">
              <div>
                <strong>賽事狀態</strong>
                <p>收齊全部成績後才可結束；結束後停止自動更新。</p>
              </div>
              <button
                disabled={busy}
                className="button subtle"
                onClick={() =>
                  save({
                    action: 'settings',
                    status: event.status === 'live' ? 'finished' : 'live',
                  })
                }
              >
                {event.status === 'live' ? '結束賽事' : '重新開放更正'}
              </button>
            </div>
            <p className="footnote">
              隊制賽採 WBF 連續 20–0 VP；雙人賽依建立時選定的 MP／CrossIMP／ButlerIMP。Cancelled 與
              Penalty 可由裁判或賽務操作。加權／平均分及跨組 Neuberg 尚未支援。
            </p>
            {event.canDirect && (
              <form
                className="import-export-section"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError('');
                  try {
                    await api(`/api/admin/events/${eventId}`, {
                      method: 'DELETE',
                      body: JSON.stringify({ confirmName: deleteName, revision: event.revision }),
                    });
                    await onDeleted();
                  } catch (error) {
                    setError((error as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <h4>刪除賽事</h4>
                <p>
                  永久刪除此賽事的賽程、成績與操作紀錄。請輸入完整賽事名稱「{event.name}」確認。
                </p>
                <label className="field">
                  確認賽事名稱
                  <input
                    value={deleteName}
                    onChange={(e) => setDeleteName(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <button className="button primary" disabled={busy || deleteName !== event.name}>
                  永久刪除賽事
                </button>
              </form>
            )}
          </>
        )}
        {section === 'penalty' && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              await save({
                action: 'penalty',
                participantId: form.get('participantId'),
                amount: Number(form.get('amount')),
                reason: form.get('reason'),
              });
            }}
          >
            <h4>判罰調整</h4>
            <p>
              設定該參賽者的累計扣分（取代既有值，非追加）；輸入 0 可撤銷。單位：
              {event.kind === 'teams'
                ? 'VP'
                : (event.pairMethod ?? 'mp') === 'mp'
                  ? '總百分點'
                  : '總 IMP'}
              。不改原始合約分。
            </p>
            <label className="field">
              處罰對象
              <select name="participantId">
                {event.participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · 目前 Penalty {event.penalties?.[p.id] ?? 0}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Penalty 扣分
              <input
                name="amount"
                type="number"
                min={0}
                max={10000}
                step="0.01"
                required
                defaultValue={0}
              />
            </label>
            <label className="field">
              裁定原因
              <input
                name="reason"
                minLength={2}
                maxLength={200}
                required
                placeholder="例如：遲到、程序違規或撤銷處罰"
              />
            </label>
            <button className="button primary" disabled={busy || event.status === 'finished'}>
              儲存判罰調整
            </button>
          </form>
        )}
        {section === 'audit' && event.canDirect && (
          <div className="audit-list">
            {[...(event.audit ?? [])].reverse().map((a) => (
              <div className="audit-item" key={a.revision}>
                <span className="audit-dot" />
                <div>
                  <strong>
                    {a.action} <small>v{a.revision}</small>
                  </strong>
                  <p>{a.reason}</p>
                  {a.detail && <p className="mono">{a.detail}</p>}
                  <small>
                    {new Date(a.at).toLocaleString('zh-TW', {
                      timeZone: 'Asia/Taipei',
                      hour12: false,
                    })}
                  </small>
                  {a.changes && (
                    <details>
                      <summary>{a.changes.length} 筆結果變更</summary>
                      {a.changes.map((c) => (
                        <p className="mono" key={c.key}>
                          {c.key}：
                          {(c.before?.split || c.after?.split) && <span className="block">不平衡合約：{[c.before, c.after].map(r => r?.split ? (['ns', 'ew'] as const).map(side => { const awarded = awardedResult(r, side)!; return `${side.toUpperCase()} ${displayContract(awarded)} ${awarded.declarer} ${resultText(awarded)}（NS 座標 ${signed(awarded.nsScore)}）`; }).join('；') : '無判罰').join(' → ')}</span>}
                          {c.before
                            ? c.before.status === 'cancelled'
                              ? 'Cancelled'
                              : `${displayContract(c.before)} ${c.before.declarer} ${resultText(c.before)} (${c.before.nsScore})`
                            : '未收分'}{' '}
                          →{' '}
                          {c.after
                            ? c.after.status === 'cancelled'
                              ? 'Cancelled'
                              : `${displayContract(c.after)} ${c.after.declarer} ${resultText(c.after)} (${c.after.nsScore})`
                            : '刪除'}
                        </p>
                      ))}
                    </details>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
