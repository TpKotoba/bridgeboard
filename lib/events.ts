import { randomUUID } from 'node:crypto';
import { roundProgress } from './round-progress';
import { buildMovement } from './movement-plans';
import { parseRoundTimes } from './round-times-import';
import { z } from 'zod';
import {
  Board,
  BridgeEvent,
  createSchema,
  Mutation,
  Result,
  ResultInput,
  StoredEvent,
  resultKey,
  seats,
  Vulnerability,
} from './model';
import { contractScore, project } from './scoring';
import { boardGroups } from './board-groups';
import { clubAccepted, clubReviewVersion, clubRoles } from './club-confirmation';
import { parsePbn, parseMovement, exportMovement, parseResultsCsv } from './imports';
const vulCycle: Vulnerability[] = [
  'None',
  'NS',
  'EW',
  'All',
  'NS',
  'EW',
  'All',
  'None',
  'EW',
  'All',
  'None',
  'NS',
  'All',
  'None',
  'NS',
  'EW',
];
export function makeBoard(number: number): Board {
  const deck = ['S', 'H', 'D', 'C'].flatMap((s) => 'AKQJT98765432'.split('').map((r) => s + r));
  let seed = number * 7919 + 41;
  for (let i = 51; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return {
    number,
    dealer: seats[(number - 1) % 4],
    vulnerability: vulCycle[(number - 1) % 16],
    deal: Object.fromEntries(
      seats.map((s, i) => [s, deck.slice(i * 13, i * 13 + 13)]),
    ) as Board['deal'],
  };
}
export function createEvent(
  input: z.infer<typeof createSchema>,
  id: string = randomUUID(),
): BridgeEvent {
  const data = createSchema.parse(input),
    now = new Date().toISOString();
  const participants = data.names.map((name, i) => ({ id: `p${i + 1}`, name, players: '' }));
  const rotation: (string | null)[] = participants.map((p) => p.id);
  if (rotation.length % 2) rotation.push(null);
  const e: BridgeEvent = {
    id,
    name: data.name,
    prefix: data.prefix ?? '',
    ...(data.firstStageName ? { hasStages: true, stageName: data.firstStageName } : {}),
    kind: data.kind,
    maxBoardNumber: data.kind === 'pairs' ? 0 : 32,
    gameMode: data.gameMode ?? 'bridge',
    date: data.date,
    venue: data.venue,
    rounds: data.rounds,
    boardsPerRound: data.boardsPerRound,
    status: 'live',
    publishBoards: false,
    pairMethod: data.pairMethod ?? 'mp',
    trim: data.kind === 'pairs' && data.pairMethod !== 'mp' ? (data.trim ?? 'none') : 'none',
    penalties: {},
    demo: false,
    participants,
    boards: Array.from({ length: data.rounds * data.boardsPerRound }, (_, i) => ({ ...makeBoard(i + 1), ...(data.gameMode === 'minibridge' ? { vulnerability: 'None' as const } : {}) })),
    assignments: [],
    results: {},
    audit: [],
    revision: 1,
    updatedAt: now,
  };
  // Rotation repeats after each full cycle, with fresh boards and IDs every round.
  // Every active table plays the same board set that round.
  // Pairs events therefore require duplicate board sets, not a physical Mitchell movement.
  for (let round = 1; round <= data.rounds; round++) {
    const boards = Array.from(
      { length: data.boardsPerRound },
      (_, i) => (round - 1) * data.boardsPerRound + i + 1,
    );
    let table = 0;
    for (let i = 0; i < rotation.length / 2; i++) {
      let a = rotation[i],
        b = rotation[rotation.length - 1 - i];
      if (!a || !b) continue;
      if ((round + i) % 2 === 0) [a, b] = [b, a];
      if (data.kind === 'teams' && Number(a.slice(1)) > Number(b.slice(1))) [a, b] = [b, a];
      table++;
      const matchId = `r${round}m${table}`;
      e.assignments.push({
        id: `${matchId}o`,
        round,
        table,
        room: data.kind === 'teams' ? 'open' : 'pairs',
        ns: a,
        ew: b,
        boards,
        matchId,
      });
      if (data.kind === 'teams')
        e.assignments.push({
          id: `${matchId}c`,
          round,
          table,
          room: 'closed',
          ns: b,
          ew: a,
          boards,
          matchId,
        });
    }
    rotation.splice(1, 0, rotation.pop()!);
  }
  // New events have no real deals until PBN import. Use empty hands instead of generated ones.
  e.boards = e.boards.map((b) => ({ ...b, deal: { N: [], E: [], S: [], W: [] } }));
  e.audit = [{ at: now, action: '建立賽事', reason: '固定輪次賽程', revision: 1 }];
  return e;
}
export class DomainError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function scoredInput(r: ResultInput, event: BridgeEvent, board: Board) {
  const miniBridge = event.gameMode === 'minibridge';
  try {
    return { ...r, miniBridge, nsScore: contractScore(r, board.vulnerability, miniBridge) };
  } catch (error) {
    throw new DomainError((error as Error).message);
  }
}
export function applyMutation(stored: StoredEvent, command: Mutation): StoredEvent {
  if (stored.requests.includes(command.requestId)) return stored;
  if (command.revision !== stored.event.revision)
    throw new DomainError('成績已被其他操作更新，請重新載入後再提交。', 409);
  const e = structuredClone(stored.event),
    at = new Date().toISOString();
  const changes: { key: string; before: Result | null; after: Result | null }[] = [];
  let detail: string | undefined;
  if (command.action === 'team-roster') {
    const p = e.participants.find(p => p.id === command.participantId);
    if (e.kind !== 'teams' || !p) throw new DomainError('找不到隊伍');
    if (new Set(command.players).size !== command.players.length) throw new DomainError('賽員不可重複');
    const removed = (p.players || '').split('、').filter(n => n && !command.players.includes(n));
    if (e.assignments.some(a => Object.values(a.playerNames ?? {}).some(n => removed.includes(n)))) throw new DomainError('請先更新使用此賽員的上場名單');
    p.players = command.players.join('、');
    p.captain = command.captain;
    detail = `${p.name}：${p.players}；隊長：${p.captain}`;
  } else if (command.action === 'table-lineup') {
    const a = e.assignments.find(a => a.id === command.assignmentId);
    if (e.kind !== 'teams' || !a) throw new DomainError('找不到隊制桌次');
    const names = Object.values(command.playerNames).filter(Boolean);
    if (new Set(names).size !== names.length) throw new DomainError('同桌賽員不可重複');
    if (e.assignments.some(other => other.id !== a.id && other.round === a.round &&
      Object.values(other.playerNames ?? {}).some(name => names.includes(name))))
      throw new DomainError('同一圈賽員不可同時在其他桌上場');
    for (const seat of ['N', 'E', 'S', 'W'] as const) {
      const p = e.participants.find(p => p.id === (seat === 'N' || seat === 'S' ? a.ns : a.ew))!;
      if (command.playerNames[seat] && !p.players.split('、').includes(command.playerNames[seat])) throw new DomainError(`${seat} 姓名不在該隊名單`);
    }
    a.playerNames = command.playerNames;
    detail = `${a.id}：${JSON.stringify(a.playerNames)}`;
  } else if (command.action === 'competition-settings') {
    if (e.parentEventId) throw new DomainError('請從賽事主頁修改共用資訊');
    e.name = command.name;
    e.prefix = command.prefix;
    e.date = command.date;
    e.venue = command.venue;
    detail = '修改賽事共用名稱、日期與地點';
  } else if (command.action === 'club-config') {
    if (e.kind !== 'pairs') throw new DomainError('俱樂部模式僅支援雙人賽');
    e.club ??= { enabled: false, tokens: {}, confirmations: {}, finalized: [] };
    e.club.enabled = command.enabled;
    if (command.inputRule !== undefined || command.assignmentId !== undefined) {
      if (e.status === 'finished') throw new DomainError('請先重新開放賽事');
      const previous = new Map(e.assignments.map(a => [a.id, clubRoles(e, a).inputPair]));
      if (command.inputRule !== undefined) {
        // Keep settled tables' historical roles when changing future input rules.
        e.club.inputOverrides ??= {};
        for (const a of e.assignments) {
          if (e.club.finalized.includes(a.round)) e.club.inputOverrides[a.id] = previous.get(a.id)!;
        }
        e.club.inputRule = command.inputRule;
      }
      if (command.assignmentId !== undefined) {
        const a = e.assignments.find(a => a.id === command.assignmentId);
        if (!a || e.club.finalized.includes(a.round)) throw new DomainError('桌次不存在或已結算');
        if (command.inputPair !== null && command.inputPair !== a.ns && command.inputPair !== a.ew) throw new DomainError('輸入方必須是該桌搭檔');
        e.club.inputOverrides ??= {};
        if (command.inputPair === null) delete e.club.inputOverrides[a.id];
        else e.club.inputOverrides[a.id] = command.inputPair;
      }
      for (const a of e.assignments) {
        if (e.club.finalized.includes(a.round)) continue;
        if (previous.get(a.id) !== clubRoles(e, a).inputPair) {
          delete e.club.confirmations[`${a.round}:${a.ns}`];
          delete e.club.confirmations[`${a.round}:${a.ew}`];
        }
      }
      detail = command.assignmentId ? `設定桌次 ${command.assignmentId} 輸入方：${command.inputPair ?? '依全局規則'}` : `設定輸入規則：${command.inputRule}`;
    }
    if (command.participantId) {
      if (!e.participants.some(p => p.id === command.participantId) || !command.tokenHash) throw new DomainError('搭檔或連結無效');
      e.club.tokens[command.participantId] = command.tokenHash;
      detail = '重新簽發 ' + command.participantId + ' 輸入連結；舊連結失效';
    }
  } else if (command.action === 'club-play') {
    const club = e.club;
    const pair = Object.entries(club?.tokens ?? {}).find(([, hash]) => hash === command.tokenHash)?.[0];
    if (!club?.enabled || !pair) throw new DomainError('連結無效或俱樂部模式未開啟', 403);
    if (e.status !== 'live' || command.round !== e.currentRound || e.roundPhase === 'break' || club.finalized.includes(command.round)) throw new DomainError('目前不開放此圈輸入', 409);
    const a = e.assignments.find(a => a.round === command.round && (a.ns === pair || a.ew === pair));
    if (!a) throw new DomainError('本圈輪空，無需提交');
    const { inputPair, confirmPair } = clubRoles(e, a);
    const confirmation = command.round + ':' + confirmPair;
    if (clubAccepted(e, a)) throw new DomainError('本桌已確認，本圈輸入已鎖定', 403);
    if (command.confirm) {
      if (pair !== confirmPair) throw new DomainError('輸入方不可確認，請由對方確認', 403);
      if (command.result) throw new DomainError('確認不可同時提交成績');
      if (a.boards.some(b => !e.results[resultKey(a.id, b)])) throw new DomainError('尚有未輸入的牌，請完成後確認');
      if (command.reviewVersion !== clubReviewVersion(e, a)) throw new DomainError('本桌成績或分工已更新，請重新檢查後確認', 409);
      club.confirmations[confirmation] = { at, forced: false, reviewVersion: command.reviewVersion };
      detail = pair + ' 確認第 ' + command.round + ' 圈';
    } else {
      if (pair !== inputPair) throw new DomainError('只能由指定輸入方輸入成績', 403);
      const r = command.result;
      if (!r || r.assignmentId !== a.id || !a.boards.includes(r.board)) throw new DomainError('只能輸入本搭檔當圈成績', 403);
      const b = e.boards.find(b => b.number === r.board)!;
      const key = resultKey(a.id, b.number);
      if (e.results[key]?.split) throw new DomainError('請先由裁判撤銷不平衡合約，再更正原始成績', 403);
      if (e.results[key]?.status === 'cancelled') throw new DomainError('取消的牌只能由裁判恢復', 403);
      const after = { ...scoredInput(r, e, b), status: 'played' as const, updatedAt: at };
      changes.push({ key, before: e.results[key] ?? null, after });
      e.results[key] = after;
      detail = pair + ' 提交第 ' + command.round + ' 圈';
    }
  } else if (command.action === 'club-finalize') {
    const club = e.club;
    if (!club?.enabled || e.status !== 'live' || command.round !== e.currentRound || club.finalized.includes(command.round)) throw new DomainError('此圈無法結算');
    const assignments = e.assignments.filter(a => a.round === command.round);
    if (!assignments.length) throw new DomainError('此圈尚未安排賽程');
    for (const a of assignments) {
      const accepted = clubAccepted(e, a);
      if (!accepted && !command.force) throw new DomainError('尚有桌次未收齊成績或對方未確認');
      for (const board of a.boards) {
        const key = resultKey(a.id, board);
        if (!e.results[key]) {
          if (!command.force) throw new DomainError('尚有成績未收齊');
          const after: Result = { assignmentId: a.id, board, level: 0, strain: 'NT', doubled: 1, declarer: 'N', tricks: 0, lead: '', status: 'cancelled', nsScore: 0, updatedAt: at };
          changes.push({ key, before: null, after });
          e.results[key] = after;
        }
      }
      if (!accepted) club.confirmations[`${command.round}:${clubRoles(e, a).confirmPair}`] = { at, forced: true, reviewVersion: clubReviewVersion(e, a) };
    }
    club.finalized.push(command.round);
    e.roundPhase = 'break';
    if (command.force && command.round < e.rounds) {
      e.currentRound = command.round + 1;
      e.roundPhase = 'playing';
    }
    detail = '第 ' + command.round + ' 圈結算並發布' + (command.force ? '（強制確認並取消未收牌）' : '');
    if (e.currentRound !== command.round) detail += `；第 ${e.currentRound} 圈開始進行`;
  } else if (command.action === 'results' || command.action === 'results-import') {
    if (e.status === 'finished') throw new DomainError('請先重新開放賽事，再更正成績。');
    const seen = new Set<string>();
    let rows: (ResultInput & { status?: 'cancelled' })[];
    try { rows = command.action === 'results-import' ? parseResultsCsv(command.csv) : command.results; }
    catch (error) { throw new DomainError((error as Error).message); }
    for (const r of rows) {
      const a = e.assignments.find((a) => a.id === r.assignmentId),
        b = e.boards.find((b) => b.number === r.board);
      if (!a || !b || !a.boards.includes(r.board)) throw new DomainError('桌次與牌號不符合賽程。');
      const key = resultKey(a.id, b.number);
      if (e.results[key]?.split) throw new DomainError('請先由裁判撤銷不平衡合約，再更正原始成績', 403);
      if (e.results[key]?.status === 'cancelled' && command.action !== 'results-import')
        throw new DomainError('Cancelled 成績只能由裁判恢復。', 403);
      if (seen.has(key)) throw new DomainError('同一批資料包含重複成績。');
      seen.add(key);
      const after: Result = r.status === 'cancelled'
        ? { ...r, status: 'cancelled', nsScore: 0, updatedAt: at }
        : { ...scoredInput(r, e, b), updatedAt: at };
      changes.push({ key, before: e.results[key] ?? null, after });
      e.results[key] = after;
    }
  } else if (command.action === 'round-control') {
    if (e.status === 'finished') throw new DomainError('請先重新開放賽事');
    if (command.round > e.rounds) throw new DomainError('圈數超過賽程範圍');
    if (command.round > 0 && !e.assignments.some((a) => a.round === command.round))
      throw new DomainError('請先安排這一圈的賽程');
    detail = `${e.currentRound ?? 0} → ${command.round}；${command.phase === 'break' ? '圈間休息' : '進行中'}`;
    e.currentRound = command.round;
    e.roundPhase = command.phase;
  } else if (command.action === 'round-times-import') {
    try {
      const rows = parseRoundTimes(command.csv, e);
      e.roundTimes ??= {};
      for (const row of rows) {
        if (row.startAt && row.endAt) e.roundTimes[row.round] = { startAt: row.startAt, endAt: row.endAt };
        else delete e.roundTimes[row.round];
      }
      detail = rows.map(row => `第 ${row.round} 圈：${row.startAt ?? '清除'} — ${row.endAt ?? '清除'}`).join('；');
    } catch (error) { throw new DomainError((error as Error).message); }
  } else if (command.action === 'round-timing') {
    if (command.round > e.rounds) throw new DomainError('圈數超過賽程範圍');
    if ((command.startAt === null) !== (command.endAt === null))
      throw new DomainError('開始與結束時間需一起填寫或一起清除');
    if (
      command.startAt &&
      command.endAt &&
      Date.parse(command.endAt) <= Date.parse(command.startAt)
    )
      throw new DomainError('結束時間必須晚於開始時間');
    e.roundTimes ??= {};
    if (command.startAt && command.endAt)
      e.roundTimes[command.round] = { startAt: command.startAt, endAt: command.endAt };
    else delete e.roundTimes[command.round];
    detail = `第 ${command.round} 圈：${command.startAt ?? '未設定'} — ${command.endAt ?? '未設定'}`;
  } else if (command.action === 'settings') {
    if (
      command.status === 'finished' &&
      new Set(e.assignments.map((a) => a.round)).size !== e.rounds
    )
      throw new DomainError('尚有輪次未安排賽程，不能結束賽事。');
    if (
      command.status === 'finished' &&
      Object.keys(e.results).length !== e.assignments.reduce((n, a) => n + a.boards.length, 0)
    )
      throw new DomainError('還有未收齊的成績，不能結束賽事。');
    if (command.status === 'finished' && e.club?.enabled && e.assignments.some(a => !e.club!.finalized.includes(a.round))) throw new DomainError('請先結算所有圈次');
    e.status = command.status;
    if (command.maxBoardNumber !== undefined) e.maxBoardNumber = command.maxBoardNumber;
    if ((e.parentEventId || e.hasStages) && (command.name !== undefined || command.prefix !== undefined)) throw new DomainError('賽事共用資訊請至賽事主頁修改');
    if (command.stageName !== undefined) {
      if (!e.hasStages && !e.parentEventId) throw new DomainError('此賽事未設賽段');
      e.stageName = command.stageName;
    }
    if (command.name !== undefined) e.name = command.name;
    if (command.prefix !== undefined) e.prefix = command.prefix;
    if (command.awardPlaces !== undefined) e.awardPlaces = command.awardPlaces;
    if (command.awardDescription !== undefined) e.awardDescription = command.awardDescription;
    if (command.movementDescription !== undefined) e.movementDescription = command.movementDescription;
    if (command.publishBoards !== undefined && command.publishBoards !== e.publishBoards)
      throw new DomainError('請使用每副牌的公開開關。');
  } else if (command.action === 'board-publication') {
    // Materialize legacy publication settings before changing just one board.
    e.boards = e.boards.map((b) => ({ ...b, published: b.published ?? e.publishBoards }));
    const b = e.boards.find((b) => b.number === command.board);
    if (!b) throw new DomainError('找不到牌號');
    const targets = boardGroups(e.boards, e.boardsPerRound).find((group) =>
      group.some((board) => board.number === b.number),
    )!;
    detail = `${targets.map((board) => `B${board.number}`).join('、')}: ${b.published ? '公開' : '隱藏'} → ${command.published ? '公開' : '隱藏'}`;
    for (const target of targets) target.published = command.published;
  } else if (command.action === 'penalty') {
    if (e.status === 'finished') throw new DomainError('請先重新開放賽事');
    if (!e.participants.some((p) => p.id === command.participantId))
      throw new DomainError('找不到參賽者');
    e.penalties ??= {};
    detail = `${command.participantId} Penalty: ${e.penalties[command.participantId] ?? 0} → ${command.amount}`;
    e.penalties[command.participantId] = command.amount;
  } else if (command.action === 'split-contract') {
    if (e.kind !== 'teams') throw new DomainError('不平衡合約僅限隊伍賽');
    if (e.status === 'finished') throw new DomainError('請先重新開放賽事');
    const a = e.assignments.find(a => a.id === command.assignmentId);
    const b = e.boards.find(b => b.number === command.board);
    if (!a || !b || !a.boards.includes(b.number)) throw new DomainError('桌次與牌號不符合賽程');
    const key = resultKey(a.id, b.number);
    const before = e.results[key];
    if (!before || before.status === 'cancelled' || before.status === 'average') throw new DomainError('請先登記或恢復本桌實際合約');
    const after: Result = { ...before, updatedAt: at };
    if (command.contracts) {
      for (const r of Object.values(command.contracts)) {
        if (r.assignmentId !== a.id || r.board !== b.number) throw new DomainError('判罰合約的桌次與牌號不符');
      }
      after.split = { ns: scoredInput(command.contracts.ns, e, b), ew: scoredInput(command.contracts.ew, e, b) };
    } else delete after.split;
    e.results[key] = after;
    changes.push({ key, before, after });
    detail = `${key}: ${command.contracts ? 'NS／EW 分別指定合約' : '撤銷不平衡合約，恢復原始紀錄'}`;
  } else if (command.action === 'ruling') {
    if (e.status === 'finished') throw new DomainError('請先重新開放賽事');
    const a = e.assignments.find((a) => a.id === command.assignmentId);
    const b = e.boards.find((b) => b.number === command.board);
    if (!a || !b || !a.boards.includes(b.number)) throw new DomainError('桌次與牌號不符合賽程');
    const key = resultKey(a.id, b.number);
    if (e.results[key]?.split) throw new DomainError('請先撤銷不平衡合約，再取消此副');
    const r = command.cancelled
      ? (e.results[key] ?? {
          assignmentId: a.id,
          board: b.number,
          level: 0,
          strain: 'NT' as const,
          doubled: 1 as const,
          declarer: 'N' as const,
          tricks: 0,
          lead: '',
        })
      : command.result;
    if (!r || r.assignmentId !== a.id || r.board !== b.number)
      throw new DomainError('恢復成績需提供此桌完整合約');
    const after: Result = {
      ...(command.cancelled ? r : scoredInput(r, e, b)),
      status: command.cancelled ? 'cancelled' : 'played',
      nsScore: command.cancelled ? 0 : scoredInput(r, e, b).nsScore,
      updatedAt: at,
    };
    changes.push({ key, before: e.results[key] ?? null, after });
    e.results[key] = after;
    detail = `${key}: ${command.cancelled ? 'Cancelled' : '恢復合約'}`;
  } else if (command.action === 'movement-plan') {
    if (e.status === 'finished' || Object.keys(e.results).length || e.club?.finalized.length)
      throw new DomainError('僅能在尚未收分且未結束的賽段套用賽程編排');
    try {
      const plan = buildMovement(e, command.plan);
      e.boards = Array.from({ length: plan.boardCount }, (_, i) => {
        const old = e.boards.find(b => b.number === i + 1);
        return { ...(old ?? { ...makeBoard(i + 1), deal: { N: [], E: [], S: [], W: [] }, published: false }),
          group: `Movement-${Math.floor(i / e.boardsPerRound) + 1}`,
          ...(e.gameMode === 'minibridge' ? { vulnerability: 'None' as const } : {}) };
      });
      parseMovement(exportMovement({ ...e, assignments: plan.assignments }), e);
      e.assignments = plan.assignments;
      e.movementImported = true;
      e.movementDescription = `${plan.option.label}；${plan.option.note}${plan.shared ? '同圈有共用牌組，請準備複製牌或安排共牌。' : ''}`;
      e.currentRound = 0;
      e.roundPhase = 'break';
      if (e.club) { e.club.confirmations = {}; e.club.inputOverrides = {}; }
      detail = e.movementDescription;
    } catch (error) { throw new DomainError((error as Error).message); }
  } else if (command.action === 'pbn') {
    if (Object.keys(e.results).length)
      throw new DomainError('已有成績時不可更換牌型與身價。請在收分前匯入。');
    let boards: Board[];
    try {
      boards = parsePbn(command.pbn);
    } catch (error) {
      throw new DomainError((error as Error).message);
    }
    if (
      boards.length !== e.boards.length ||
      boards.some((b) => !e.boards.some((x) => x.number === b.number))
    )
      throw new DomainError('PBN 需包含賽事所有牌號，且不得包含額外牌號。');
    const ordered = [...boards].sort((a, b) => a.number - b.number);
    const explicitGroups = new Set(boards.map((b) => b.group).filter(Boolean));
    let prefix = 'Auto';
    while ([...explicitGroups].some((group) => group!.startsWith(`${prefix}-`))) prefix += '_';
    e.boards = boards.map((b) => ({
      ...b,
      ...(e.gameMode === 'minibridge' ? { vulnerability: 'None' as const } : {}),
      group:
        b.group ??
        `${prefix}-${Math.floor(ordered.findIndex((item) => item.number === b.number) / e.boardsPerRound) + 1}`,
      published: e.boards.find((old) => old.number === b.number)?.published ?? e.publishBoards,
    }));
    for (const b of e.boards) {
      if (e.boards.some((other) => other.group === b.group && !other.published))
        b.published = false;
    }
  } else {
    if (e.status === 'finished') throw new DomainError('請先重新開放賽事');
    try {
      const incoming = parseMovement(command.csv, e);
      const rounds = new Set(incoming.map((a) => a.round));
      const scoredRounds = new Set(
        e.assignments
          .filter((a) => a.boards.some((b) => e.results[resultKey(a.id, b)]))
          .map((a) => a.round),
      );
      for (const a of incoming) {
        if (!scoredRounds.has(a.round)) continue;
        const old = e.assignments.find(
          (item) => item.round === a.round && String(item.table) === String(a.table) && item.room === a.room,
        );
        if (
          !old ||
          old.ns !== a.ns ||
          old.ew !== a.ew ||
          [...old.boards].sort((x, y) => x - y).join(',') !==
            [...a.boards].sort((x, y) => x - y).join(',')
        )
          throw new Error(`第 ${a.round} 輪已有成績，不可改動其賽程`);
        a.id = old.id;
        a.matchId = old.matchId;
        a.playerNames = old.playerNames;
      }
      const combined = [
        ...e.assignments.filter(
          (a) => !rounds.has(a.round) && (e.kind === 'teams' || e.movementImported || scoredRounds.has(a.round)),
        ),
        ...incoming,
      ];
      parseMovement(exportMovement({ ...e, assignments: combined }), e);
      e.assignments = combined.sort(
        (a, b) =>
          a.round - b.round ||
          String(a.table).localeCompare(String(b.table), 'en', { numeric: true }),
      );
      e.movementImported = true;
    } catch (error) {
      throw new DomainError((error as Error).message);
    }
  }
  if (e.status === 'live' && !e.club?.enabled &&
      ['results', 'results-import', 'ruling', 'split-contract', 'round-control'].includes(command.action)) {
    if (command.action === 'results' || command.action === 'results-import') {
      const latest = roundProgress({ ...e, currentRound: 0 }).round;
      if (latest > (e.currentRound ?? 0)) {
        e.currentRound = latest;
        e.roundPhase = 'playing';
      }
    }
    const progress = roundProgress(e);
    if (progress.expected > 0 && progress.received === progress.expected) {
      e.currentRound = progress.round;
      e.roundPhase = 'break';
      detail = [detail, `第 ${progress.round} 圈成績收齊，自動進入圈間休息`].filter(Boolean).join('；');
    }
  }
  e.revision++;
  e.updatedAt = at;
  e.audit.push({
    at,
    action: {
      'competition-settings': '賽事共用資訊',
      'team-roster': '隊伍賽員名單',
      'table-lineup': '桌次上場名單',
      'club-config': '俱樂部模式設定',
      'club-play': '搭檔提交／確認',
      'club-finalize': '圈次結算',
      results: '收分／更正',
      'results-import': '匯入成績',
      settings: '發布設定',
      pbn: '匯入牌型',
      movement: '匯入賽程編排',
      'movement-plan': '套用賽程編排',
      'board-publication': '逐副公開設定',
      'round-control': '設定目前圈數',
      'round-timing': '設定圈次時間',
      'round-times-import': '匯入各圈時間區間',
      ruling: '裁判取消／恢復',
      'split-contract': '不平衡合約',
      penalty: '裁判 Penalty',
    }[command.action],
    reason: command.reason,
    revision: e.revision,
    detail,
    ...(changes.length ? { changes } : {}),
  });
  return {
    event: e,
    requests: [...stored.requests, command.requestId].slice(-500),
    projection: project(e),
  };
}
export function seedEvents(): StoredEvent[] {
  const names = ['臺北松山', '新竹交大', '臺中青鳥', '臺南南風', '高雄海港', '花蓮山海'];
  const team = createEvent(
    {
      name: '秋季橋牌邀請賽',
      kind: 'teams',
      date: '2026-10-12',
      venue: '臺北・橋牌交流中心',
      names,
      rounds: 5,
      boardsPerRound: 8,
    },
    'autumn-teams',
  );
  const pairs = createEvent(
    {
      name: '週末雙人積分賽',
      kind: 'pairs',
      date: '2026-10-12',
      venue: '臺北・橋牌交流中心',
      names: [
        '林冠宇 / 陳思妤',
        '張哲維 / 王品涵',
        '李柏翰 / 黃詠晴',
        '吳承恩 / 劉芷瑜',
        '蔡宗翰 / 楊庭安',
        '許家豪 / 鄭雅文',
        '謝宇軒 / 郭子晴',
        '洪偉倫 / 曾心怡',
        '邱俊傑 / 賴佩珊',
        '徐博文 / 周佳穎',
        '蘇奕辰 / 葉婉婷',
        '莊凱翔 / 廖昀潔',
        '江紹廷 / 何映彤',
        '蕭立衡 / 宋采蓉',
        '梁昱廷 / 方予安',
      ],
      rounds: 13,
      boardsPerRound: 2,
    },
    'weekend-pairs',
  );
  return [team, pairs].map((e) => {
    e.demo = true;
    e.publishBoards = true;
    e.boards = e.boards.map((b) => makeBoard(b.number));
    const lastRound = e.kind === 'teams' ? 3 : 9;
    for (const a of e.assignments)
      for (const board of a.boards) {
        const tableIndex = Number(a.table) || e.assignments.indexOf(a) + 1;
        if (a.round > lastRound || (a.round === lastRound && (tableIndex + board) % 3 === 0))
          continue;
        const n = board * 13 + tableIndex * 7 + (a.room === 'closed' ? 3 : 0);
        const level = [3, 4, 2, 3, 4, 6][n % 6],
          strain = (['NT', 'S', 'H', 'D', 'S', 'NT'] as const)[n % 6];
        const r = {
          assignmentId: a.id,
          board,
          level,
          strain,
          doubled: 1 as const,
          declarer: (['N', 'E', 'S', 'W'] as const)[n % 4],
          tricks: Math.min(13, level + 6 + (n % 4) - 1),
          lead: '',
          updatedAt: e.updatedAt,
        };
        e.results[resultKey(a.id, board)] = {
          ...r,
          nsScore: contractScore(r, e.boards[board - 1].vulnerability),
        };
      }
    return { event: e, requests: [], projection: project(e) };
  });
}
