import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  Board,
  BridgeEvent,
  createSchema,
  Mutation,
  Result,
  StoredEvent,
  resultKey,
  seats,
  Vulnerability,
} from './model';
import { contractScore, project } from './scoring';
import { boardGroups } from './board-groups';
import { parsePbn, parseMovement, exportMovement } from './imports';
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
    kind: data.kind,
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
    boards: Array.from({ length: data.rounds * data.boardsPerRound }, (_, i) => makeBoard(i + 1)),
    assignments: [],
    results: {},
    audit: [],
    revision: 1,
    updatedAt: now,
  };
  // Fixed round-robin schedule. Every active table plays the same board set that round.
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
export function applyMutation(stored: StoredEvent, command: Mutation): StoredEvent {
  if (stored.requests.includes(command.requestId)) return stored;
  if (command.revision !== stored.event.revision)
    throw new DomainError('成績已被其他操作更新，請重新載入後再提交。', 409);
  const e = structuredClone(stored.event),
    at = new Date().toISOString();
  const changes: { key: string; before: Result | null; after: Result | null }[] = [];
  let detail: string | undefined;
  if (command.action === 'results') {
    if (e.status === 'finished') throw new DomainError('請先重新開放賽事，再更正成績。');
    const seen = new Set<string>();
    for (const r of command.results) {
      const a = e.assignments.find((a) => a.id === r.assignmentId),
        b = e.boards.find((b) => b.number === r.board);
      if (!a || !b || !a.boards.includes(r.board)) throw new DomainError('桌次與牌號不符合賽程。');
      const key = resultKey(a.id, b.number);
      if (e.results[key]?.status === 'cancelled')
        throw new DomainError('Cancelled 成績只能由裁判恢復。', 403);
      if (seen.has(key)) throw new DomainError('同一批資料包含重複成績。');
      seen.add(key);
      const after = { ...r, nsScore: contractScore(r, b.vulnerability), updatedAt: at };
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
    if (
      command.status === 'finished' &&
      e.kind === 'pairs' &&
      e.boards.some(
        (b) =>
          Object.values(e.results).filter((r) => r.board === b.number && r.status !== 'cancelled')
            .length === 1,
      )
    )
      throw new DomainError('有牌只剩一桌有效結果，無法比較；請裁判處理後再結束。');
    e.status = command.status;
    if (command.name !== undefined) e.name = command.name;
    if (command.prefix !== undefined) e.prefix = command.prefix;
    if (command.awardPlaces !== undefined) e.awardPlaces = command.awardPlaces;
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
  } else if (command.action === 'ruling') {
    if (e.status === 'finished') throw new DomainError('請先重新開放賽事');
    const a = e.assignments.find((a) => a.id === command.assignmentId);
    const b = e.boards.find((b) => b.number === command.board);
    if (!a || !b || !a.boards.includes(b.number)) throw new DomainError('桌次與牌號不符合賽程');
    const key = resultKey(a.id, b.number);
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
      ...r,
      status: command.cancelled ? 'cancelled' : 'played',
      nsScore: contractScore(r, b.vulnerability),
      updatedAt: at,
    };
    changes.push({ key, before: e.results[key] ?? null, after });
    e.results[key] = after;
    detail = `${key}: ${command.cancelled ? 'Cancelled' : '恢復合約'}`;
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
    if (e.kind !== 'pairs') throw new DomainError('Movement 匯入僅適用雙人賽。');
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
          (item) => item.round === a.round && String(item.table) === String(a.table),
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
      }
      const combined = [
        ...e.assignments.filter(
          (a) => !rounds.has(a.round) && (e.movementImported || scoredRounds.has(a.round)),
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
  e.revision++;
  e.updatedAt = at;
  e.audit.push({
    at,
    action: {
      results: '收分／更正',
      settings: '發布設定',
      pbn: '匯入牌型',
      movement: '匯入 movement',
      'board-publication': '逐副公開設定',
      'round-control': '設定目前圈數',
      'round-timing': '設定圈次時間',
      ruling: '裁判取消／恢復',
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
