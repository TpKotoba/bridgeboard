'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { boardGroups, boardRange } from '@/lib/board-groups';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
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
import { DealExplorer } from './deal-explorer';
import { tableNames } from '@/lib/table-names';
import { boardRounds as getBoardRounds } from '@/lib/board-navigation';
import { contractScore, imps } from '@/lib/scoring';
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
function signed(n: number) {
  return n > 0 ? `+${n}` : String(n);
}
function displayContract(r: ResultInput) {
  return r.level === 0
    ? 'PASS'
    : `${r.level}${suitSymbols[r.strain]}${r.doubled === 2 ? 'X' : r.doubled === 4 ? 'XX' : ''}`;
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
  if (result?.status === 'cancelled') return <span className="badge">Cancelled</span>;
  return result ? (
    <span className={`contract ${result.strain === 'H' || result.strain === 'D' ? 'red' : ''}`}>
      {displayContract(result)}{' '}
      <small>
        {result.level ? seatNames[result.declarer] : ''} {resultText(result)}
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
  const [travellerSide, setTravellerSide] = useState<'ns' | 'ew'>('ns');
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
  const [sessionExpanded, setSessionExpanded] = useState(false);
  const [showLogin, setShowLogin] = useState(false),
    [showCreate, setShowCreate] = useState(false),
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
        setId(list.find((e) => e.id === requested)?.id ?? list[0]?.id ?? '');
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
  function toggleFollow(value: string) {
    const next = follow === value ? '' : value;
    setFollow(next);
    try {
      localStorage.setItem('bridge-follow', next);
    } catch {}
  }
  function openAdmin() {
    if (!admin) setShowLogin(true);
    else if (!id && director) setShowCreate(true);
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
      setShowLogin(false);
      setTab('admin');
      if (!id && session.director) setShowCreate(true);
    } catch (e) {
      setLoginError((e as Error).message);
    } finally {
      setLoggingIn(false);
    }
  }
  const name = (pid: string) => event?.participants.find((p) => p.id === pid)?.name ?? pid;
  const playerId = person || event?.participants[0]?.id;
  let playerBand = 0;
  const playerRows = (event?.assignments ?? [])
    .filter((a) => a.ns === playerId || a.ew === playerId)
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
          .filter((r) => r && r.status !== 'cancelled')
          .map((r) => r.nsScore)
      : [];
  const averageBoardScore = completedBoardScores.length
    ? completedBoardScores.reduce((sum, score) => sum + score, 0) / completedBoardScores.length
    : null;
  const pairMethod = event?.pairMethod ?? 'mp';
  const scoreSide = event?.kind === 'pairs' ? travellerSide : 'ns';
  const sideSign = scoreSide === 'ns' ? 1 : -1;
  const sideLabel = scoreSide.toUpperCase();
  const traveller =
    event && selectedBoard
      ? event.assignments
          .filter((a) => a.boards.includes(selectedBoard.number))
          .sort((a, b) => {
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
          <span className="brand-symbol">♦</span>
          <span>
            bridgeboard<small>橋牌賽事記分</small>
          </span>
        </a>
        <div className="sidebar-label">賽事工作區</div>
        <button className="workspace-button" onClick={() => setTab('standings')}>
          <LayoutDashboard size={18} />
          <span>賽事總覽</span>
          <ChevronRight size={15} />
        </button>
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
          <div className="sidebar-note">
            <span className="tiny-suits">
              ♠ <b>♥ ♦</b> ♣
            </span>
            <p>每一副牌，都值得記錄。</p>
            <small>Bridgeboard · MVP 0.1</small>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            賽事中心 <ChevronRight size={14} />{' '}
            <span>{event?.kind === 'pairs' ? '雙人賽' : '隊制賽'}</span>
          </div>
          <div className="top-actions">
            {admin ? (
              <div className={`session-control ${sessionExpanded ? 'expanded' : ''}`}
                onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setSessionExpanded(false); }}
                onKeyDown={(e) => { if (e.key === 'Escape') setSessionExpanded(false); }}>
                <button className="session-role" aria-expanded={sessionExpanded} aria-controls="session-logout"
                  onClick={() => setSessionExpanded((expanded) => !expanded)}>
                  {director ? '裁判' : '賽務'}
                </button>
                <button
                  id="session-logout"
                  className="session-logout"
                  tabIndex={sessionExpanded ? 0 : -1}
                  aria-hidden={!sessionExpanded}
                  onClick={async () => {
                    await api('/api/session', { method: 'DELETE' });
                    setSessionExpanded(false);
                    setAdmin(false);
                    setDirector(false);
                    setTab('standings');
                  }}
                >
                  登出
                </button>
              </div>
            ) : (
              <button className="button subtle login-button" onClick={openAdmin}>
                登入
              </button>
            )}
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">TOURNAMENT CENTER</div>
              <h1>橋藝競賽記分板</h1>
              <p>還在用過時的 Excel 試算表舉辦比賽嗎？</p>
            </div>
            {admin && (
              <button className="button subtle admin-menu-button" onClick={openAdmin}>
                <Settings2 size={16} />
                {director ? '裁判功能表' : '賽務功能表'}
              </button>
            )}
          </div>
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
              <div className="event-strip">
                {events.map((e) => (
                  <button
                    key={e.id}
                    className={`event-option ${id === e.id ? 'selected' : ''}`}
                    onClick={() => {
                      setId(e.id);
                      if (tab === 'admin') setTab('standings');
                    }}
                  >
                    <span className={`event-icon ${e.kind}`}>
                      {e.kind === 'teams' ? <Flag size={20} /> : <Users size={20} />}
                    </span>
                    <span>
                      <strong>{e.name}</strong>
                      <small>
                        {e.kind === 'teams'
                          ? '隊制賽 · IMP / VP'
                          : `雙人賽 · ${methodNames[e.pairMethod ?? 'mp']}`}
                        　{e.date.slice(5).replace('-', ' / ')}
                      </small>
                    </span>
                    <span className={`event-status ${e.status === 'finished' ? 'done' : ''}`}>
                      {e.status === 'finished' ? '已結束' : '進行中'}
                    </span>
                  </button>
                ))}
              </div>
              {!events.length && (
                <div className="empty">
                  <Trophy size={36} />
                  <h2>準備好第一場比賽</h2>
                  <p>由裁判建立隊制賽或雙人賽。</p>
                  <button className="button primary" onClick={openAdmin}>
                    {admin ? (director ? '建立賽事' : '賽務功能表') : '登入'}
                  </button>
                </div>
              )}
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
                      <div className="section-kicker">
                        {event.demo ? 'SAMPLE EVENT' : 'OFFICIAL WORKSPACE'} <span>／</span>{' '}
                        {event.kind === 'teams' ? 'TEAM TOURNAMENT' : 'PAIRS TOURNAMENT'}
                      </div>
                      <h2>
                        {event.name.split(/\s+/).map((part, index) => (
                          <span className="event-name-part" key={index}>
                            {index > 0 ? ' ' : ''}
                            {part}
                          </span>
                        ))}
                      </h2>
                      <div className="event-meta">
                        <span>{event.date}</span>
                        <span>{event.venue || '線上記分'}</span>
                        <span className="event-format">
                          {event.kind === 'teams'
                            ? 'WBF 20–0 VP'
                            : `${methodNames[pairMethod]} · 合併排名 · ${event.trim === 'one' ? '各去一筆' : event.trim === 'ten-percent' ? '各去 10%' : '不去頭尾'}`}
                        </span>
                      </div>
                    </div>
                    <button
                      className={`button subtle ${refreshing ? 'refreshing' : ''}`}
                      disabled={refreshing}
                      onClick={refresh}
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
                  <div className="stats-grid">
                    <Stat
                      label={event.kind === 'teams' ? '參賽隊伍' : '參賽搭檔'}
                      value={event.participants.length}
                      suffix={event.kind === 'teams' ? '隊' : '對'}
                      icon={<Users />}
                    />
                    <Stat label="賽程輪次" value={event.rounds} suffix="輪" icon={<Flag />} />
                    <Stat
                      label="比賽牌數"
                      value={event.boards.length}
                      suffix="副"
                      icon={<Spade />}
                    />
                    <Stat
                      label="已收成績"
                      value={event.projection.received}
                      suffix={`/ ${event.projection.expected}`}
                      progress={
                        event.projection.expected
                          ? event.projection.received / event.projection.expected
                          : 0
                      }
                    />
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
                              {event.status === 'finished' ? '最終成績' : '暫定成績'}
                            </span>
                          </h3>
                          <p>
                            {event.kind === 'teams'
                              ? 'VP 僅計入兩房全部收齊的對戰；同分並列。'
                              : '依有效結果暫時計分；Cancelled 不參與比較，Penalty 扣除後排名，同分並列。'}
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
                        <table className="ranking-table">
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
                                  s.id.includes(query),
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
                                        {s.name}
                                        <small>
                                          {s.id.toUpperCase()} {s.players && ` · ${s.players}`}
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
                            s.id.includes(query),
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
                                第 {m.round} 輪{' '}
                                <span>
                                  {m.completed === m.total
                                    ? '已收齊'
                                    : `已比對 ${m.completed} / ${m.total} 副`}
                                </span>
                              </div>
                              <div className="match-team">
                                <strong>{name(m.a)}</strong>
                                <b>{m.impsA}</b>
                              </div>
                              <div className="match-team">
                                <strong>{name(m.b)}</strong>
                                <b>{m.impsB}</b>
                              </div>
                              <div className="match-bottom">
                                <span>
                                  VP{' '}
                                  <b>
                                    {number(m.vpA)} : {number(m.vpB)}
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
                                                {id.toUpperCase()} /{' '}
                                                {score == null
                                                  ? '—'
                                                  : `${pairMethod !== 'mp' && score >= 0 ? '+' : ''}${number(score, pairMethod === 'butler' && Number.isInteger(score) ? 0 : 2)}${pairMethod === 'mp' ? '%' : ' IMP'}`}
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
                      <div
                        className={`board-nav board-jump ${event.kind === 'pairs' ? 'pairs-board-jump' : ''}`}
                      >
                        <button
                          className="icon-button"
                          aria-label="上一副"
                          disabled={selectedBoard.number <= 1}
                          onClick={() => setBoard(selectedBoard.number - 1)}
                        >
                          <ArrowLeft size={18} />
                        </button>
                        {event.kind === 'teams' && (
                          <label>
                            <select
                              aria-label="選擇圈數"
                              value={boardRound?.round ?? 1}
                              onChange={(e) =>
                                setBoard(
                                  boardRounds.find((r) => r.round === Number(e.target.value))
                                    ?.boards[0] ?? 1,
                                )
                              }
                            >
                              {boardRounds.map((r) => (
                                <option key={r.round} value={r.round}>
                                  第 {r.round} 圈
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <label>
                          <select
                            aria-label={event.kind === 'teams' ? '選擇圈內第幾牌' : '選擇牌號'}
                            value={
                              event.kind === 'teams' ? boardNumberInRound : selectedBoard.number
                            }
                            onChange={(e) =>
                              setBoard(
                                event.kind === 'teams'
                                  ? (boardRound?.boards[Number(e.target.value)] ?? 1)
                                  : Number(e.target.value),
                              )
                            }
                          >
                            {event.kind === 'teams'
                              ? boardRound?.boards.map((number, index) => (
                                  <option key={`${number}-${index}`} value={index}>
                                    第 {index + 1} 牌
                                  </option>
                                ))
                              : event.boards.map((board) => (
                                  <option key={board.number} value={board.number}>
                                    牌號 {board.number}
                                  </option>
                                ))}
                          </select>
                        </label>
                        <button
                          className="icon-button"
                          aria-label="下一副"
                          disabled={selectedBoard.number >= event.boards.length}
                          onClick={() => setBoard(selectedBoard.number + 1)}
                        >
                          <ArrowRight size={18} />
                        </button>
                      </div>
                      <div className="board-layout">
                        <section className="panel deal-panel">
                          <div className="panel-heading">
                            <h3 className="board-summary">
                              牌號 {selectedBoard.number}
                              <span>
                                （{sideLabel} 平均分{' '}
                                {averageBoardScore === null
                                  ? '—'
                                  : `${averageBoardScore * sideSign >= 0 ? '+' : ''}${number(averageBoardScore * sideSign)}`}
                                ，{completedBoardScores.length} 桌有效結果）
                              </span>
                            </h3>
                          </div>
                          {hasDeal(selectedBoard) && selectedBoard.deal.N.length === 13 ? (
                            <DealExplorer
                              key={`${event.id}:${selectedBoard.number}`}
                              board={selectedBoard}
                              result={activeResult}
                              playerNames={activeNames}
                              resultSelection={resultSelection}
                              tableSelected={!!activeAssignment}
                              onManualTrial={() => setSelectedResult('')}
                            />
                          ) : (
                            <DealDiagram board={selectedBoard} />
                          )}
                          {hasDeal(selectedBoard) && selectedBoard.deal.N.length > 0 && (
                            <button
                              className="button subtle full"
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
                          )}
                        </section>
                        <section className="panel board-results">
                          <div className="panel-heading">
                            <div>
                              <h3>{event.kind === 'teams' ? '兩房逐副比較' : '單副成績表'}</h3>
                            </div>
                          </div>
                          <div className="table-scroll">
                            {event.kind === 'teams' ? (
                              <table>
                                <thead>
                                  <tr>
                                    {sortHeading('table', '隊伍對戰／桌次')}
                                    {sortHeading('score', '開室 NS 分')}
                                    <th>閉室</th>
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
                                          aria-pressed={selectedResult === a.id}
                                          onClick={() => chooseResult(a.id)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                              e.preventDefault();
                                              chooseResult(a.id);
                                            }
                                          }}
                                          aria-label={`選取第 ${a.table} 桌開室，點閉室欄可選閉室`}
                                        >
                                          <td>
                                            <strong>{name(a.ns)}</strong>
                                            <small className="block muted">vs {name(a.ew)}</small>
                                          </td>
                                          <td>
                                            <Contract result={x} />
                                            <small className="block mono">
                                              {x && x.status !== 'cancelled'
                                                ? signed(x.nsScore)
                                                : '—'}
                                            </small>
                                          </td>
                                          <td
                                            tabIndex={0}
                                            role="button"
                                            aria-label={`選取第 ${a.table} 桌閉室，查看首攻`}
                                            aria-pressed={selectedResult === closed.id}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              chooseResult(closed.id);
                                            }}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                chooseResult(closed.id);
                                              }
                                            }}
                                          >
                                            <Contract result={y} />
                                            <small className="block mono">
                                              {y && y.status !== 'cancelled'
                                                ? signed(y.nsScore)
                                                : '—'}
                                            </small>
                                          </td>
                                          <td className="accent mono">
                                            {x?.status === 'cancelled' || y?.status === 'cancelled'
                                              ? 'Cancelled'
                                              : x && y
                                                ? signed(imps(x.nsScore + y.nsScore))
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
                              IMP 以左列第一支隊伍為正；閉室南北為對手，兩房 NS 分相加後換算。
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
                          <p>每輪桌次、合約與得分紀錄。</p>
                        </div>
                        <div className="participant-picker">
                          查看{event.kind === 'teams' ? '隊伍' : '搭檔'}
                          <button
                            className="participant-picker-trigger"
                            aria-label="選擇參賽者"
                            popoverTarget="participant-options"
                            onClick={(e) => positionDetail(e.currentTarget)}
                          >
                            <span>{(person || event.participants[0].id).toUpperCase()}</span>
                            <span>{name(person || event.participants[0].id)}</span>
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
                                <span>{p.id.toUpperCase()}</span>
                                <span>{p.name}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th aria-sort={playerSort === 'round' ? 'ascending' : 'none'}>
                                <button
                                  className="contract-link"
                                  onClick={() => setPlayerSort('round')}
                                >
                                  輪次／桌
                                </button>
                              </th>
                              <th aria-sort={playerSort === 'board' ? 'ascending' : 'none'}>
                                <button
                                  className="contract-link"
                                  onClick={() => setPlayerSort('board')}
                                >
                                  牌號
                                </button>
                              </th>
                              <th>方向</th>
                              <th aria-sort={playerSort === 'opponent' ? 'ascending' : 'none'}>
                                <button
                                  className="contract-link"
                                  onClick={() => setPlayerSort('opponent')}
                                >
                                  對手
                                </button>
                              </th>
                              <th>合約</th>
                              <th>己方原始分</th>
                              <th>
                                {event.kind === 'pairs'
                                  ? pairMethod === 'mp'
                                    ? 'MP%'
                                    : 'IMP'
                                  : '房間'}
                              </th>
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
                                  <td>
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
                                  </td>
                                  <td>
                                    <button className="text-button" onClick={openBoard}>
                                      {b}
                                    </button>
                                  </td>
                                  <td>{ns ? 'NS' : 'EW'}</td>
                                  <td>
                                    <span className="opponent-name">
                                      {name(ns ? a.ew : a.ns)}{' '}
                                      <small className="muted">
                                        {(ns ? a.ew : a.ns).toUpperCase()}
                                      </small>
                                    </span>
                                    <button
                                      className="opponent-number contract-link"
                                      popoverTarget={`${popupId}-opponent`}
                                      onClick={(e) => positionDetail(e.currentTarget)}
                                    >
                                      {(ns ? a.ew : a.ns).toUpperCase()}
                                    </button>
                                    <div
                                      id={`${popupId}-opponent`}
                                      popover="auto"
                                      className="player-detail-popover"
                                    >
                                      對手：{(ns ? a.ew : a.ns).toUpperCase()} ·{' '}
                                      {name(ns ? a.ew : a.ns)}
                                    </div>
                                  </td>
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
                                  <td
                                    className={
                                      event.kind === 'pairs'
                                        ? `player-points ${pairTone(value, mp?.top ?? 0, pairMethod)}`
                                        : undefined
                                    }
                                  >
                                    <span className="player-points-value">
                                      {event.kind === 'teams'
                                        ? a.room === 'open'
                                          ? '開室'
                                          : '閉室'
                                        : value !== null && mp
                                          ? pairValue(value, mp.top, pairMethod)
                                          : '—'}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
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
                      onCreate={() => setShowCreate(true)}
                      onDeleted={async () => {
                        requestGeneration.current++;
                        setEvent(null);
                        const list = await refreshList();
                        setId(list[0]?.id ?? '');
                        setTab('standings');
                        setNotice('賽事已刪除。');
                      }}
                      onLogout={async () => {
                        await api('/api/session', { method: 'DELETE' });
                        setAdmin(false);
                        setDirector(false);
                        setTab('standings');
                      }}
                    />
                  )}
                  <footer className="page-footer">
                    <span>
                      BRIDGEBOARD <span>／</span> 由臺灣大學橋藝社自主研發
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
              <input
                autoFocus
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
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
      {showCreate && (
        <CreateDialog
          onClose={() => setShowCreate(false)}
          onCreated={async (newId) => {
            await refreshList();
            setId(newId);
            setTab('admin');
            setShowCreate(false);
            setNotice('賽事已建立。請先核對賽程與匯入牌型，再開始收分。');
          }}
        />
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
}: {
  label: string;
  value: number;
  suffix: string;
  icon?: React.ReactNode;
  progress?: number;
}) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        {icon ?? <Activity size={18} />}
      </div>
      <div className="stat-value">
        {value}
        <small>{suffix}</small>
      </div>
      {progress !== undefined ? (
        <div className="progress-track">
          <span style={{ width: `${progress * 100}%` }} />
        </div>
      ) : (
        <div className="stat-line" />
      )}
    </div>
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
function Modal({
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
function CreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<Kind>('teams'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [method, setMethod] = useState('mp');
  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = new FormData(ev.currentTarget);
    setBusy(true);
    setError('');
    try {
      const res = await api<{ id: string }>('/api/events', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          pairMethod: kind === 'pairs' ? method : 'mp',
          trim: kind === 'pairs' && method !== 'mp' ? form.get('trim') : 'none',
          name: form.get('name'),
          date: form.get('date'),
          venue: form.get('venue'),
          rounds: Number(form.get('rounds')),
          boardsPerRound: Number(form.get('boardsPerRound')),
          names: String(form.get('names'))
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      await onCreated(res.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="建立新賽事" onClose={onClose}>
      <form onSubmit={submit}>
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
            <label className="field">
              計分模式
              <select
                aria-label="計分模式"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                <option value="mp">MP 百分比</option>
                <option value="crossimp">CrossIMP</option>
                <option value="butler">ButlerIMP</option>
              </select>
            </label>
            <label className="field">
              去頭去尾
              <select name="trim" disabled={method === 'mp'} defaultValue="none">
                <option value="none">不去除</option>
                <option value="one">最高、最低各去一筆</option>
                <option value="ten-percent">最高、最低各去 10%（向下取整）</option>
              </select>
            </label>
            <p className="footnote">
              Butler：樣本算術平均取最近 10 分（恰為 5 時遠離零），各桌與此 datum 比
              IMP。CrossIMP：每桌對其他桌的 IMP
              取平均。去尾僅影響比較樣本，所有有效桌次仍計分；樣本少於三筆不去尾。IMP
              排名採累計總分。
            </p>
          </div>
        )}
        <label className="field">
          賽事名稱
          <input
            name="name"
            required
            minLength={2}
            maxLength={80}
            placeholder="例如：秋季俱樂部邀請賽"
          />
        </label>
        <div className="form-grid">
          <label className="field">
            日期
            <input
              name="date"
              type="date"
              required
              defaultValue={new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })}
            />
          </label>
          <label className="field">
            地點
            <input name="venue" maxLength={80} placeholder="比賽地點" />
          </label>
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
          預設建立固定循環對戰，各桌每輪打相同牌組。雙人賽需備妥重複牌組，或在收分前匯入自己的
          movement。排名同分並列。
        </p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={busy}>
          {busy ? '建立中…' : '建立賽事與賽程'}
        </button>
      </form>
    </Modal>
  );
}
function AdminPanel({
  eventId,
  onSaved,
  onCreate,
  onDeleted,
  onLogout,
}: {
  eventId: string;
  onSaved: (s: string) => Promise<void>;
  onCreate: () => void;
  onDeleted: () => Promise<void>;
  onLogout: () => Promise<void>;
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
      r
        ? {
            assignmentId: r.assignmentId,
            board: r.board,
            level: r.level,
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
      <div className="panel-heading">
        <div>
          <h3>
            {event.canDirect ? '裁判後台' : '賽務後台'}{' '}
            <span className="badge">版本 {event.revision}</span>
          </h3>
          <p>原始結果、排名與更正紀錄一併儲存。</p>
        </div>
        <div className="button-row">
          {event.canDirect && (
            <button className="button subtle" onClick={onCreate}>
              <Plus size={15} />
              新賽事
            </button>
          )}
          <button className="button subtle" onClick={onLogout}>
            登出
          </button>
        </div>
      </div>
      <div className="admin-tabs">
        {[
          ['score', '收分／更正'],
          ...(event.canDirect ? [['import', '匯入／匯出']] : []),
          ['publish', event.canDirect ? '發布設定' : '賽事設定'],
          ['penalty', '判罰調整'],
          ...(event.canDirect ? [['audit', '操作紀錄']] : []),
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
                        {a.table}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <div className="seating-note">
              <span>
                <b>NS</b> {selected ? name(selected.ns) : ''}
              </span>
              <span>
                <b>EW</b> {selected ? name(selected.ew) : ''}
              </span>
            </div>
            <div className="form-grid four">
              <label className="field">
                牌號
                <select value={board} onChange={(e) => setBoard(Number(e.target.value))}>
                  {selected?.boards.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </label>
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
            <button
              className="button primary"
              disabled={busy || event.status === 'finished' || existing?.status === 'cancelled'}
            >
              <Check size={16} />
              {busy ? '儲存中…' : existing ? '儲存更正並重算' : '提交成績'}
            </button>
            <div className="director-controls">
              <strong>結果裁定</strong>
              <p>
                Cancelled 排除此桌此副的比較並視為已處理，不等於 Pass
                out。請先在上方填寫裁定原因；恢復時採用上方合約。
              </p>
              <button
                type="button"
                className="button subtle"
                disabled={busy || event.status === 'finished' || reason.trim().length < 2}
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
                {existing?.status === 'cancelled' ? '恢復為上方合約' : '設為 Cancelled'}
              </button>
            </div>
            {event.status === 'finished' && (
              <p className="footnote">賽事已結束；更正前請至發布設定重新開放。</p>
            )}
          </form>
        )}
        {section === 'import' && event.canDirect && (
          <>
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
                    Movement CSV
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
            <section className="import-export-section">
              <h4>匯入資料</h4>
              <a className="button subtle" href="/docs/import-formats.md" download>
                <ArrowDownToLine size={16} />
                下載匯入格式文件
              </a>
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
                  {event.kind === 'pairs' && <option value="movement">Movement CSV</option>}
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
                先匯出範例了解欄位。搭檔 ID 可從 movement 查閱；成績使用 assignmentId 與 board
                定位。牌型僅能在尚未收分時替換；movement
                可逐圈補入，每圈必須完整，已收分輪次不可改動。
              </p>
            </section>
          </>
        )}
        {section === 'publish' && (
          <>
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
              className="setting-row"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                void save({
                  action: 'settings',
                  status: event.status,
                  awardPlaces: Number(form.get('awardPlaces')),
                  reason: '設定給獎名次',
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
              <button className="button subtle" disabled={busy}>
                儲存給獎設定
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
