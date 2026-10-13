import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent, applyMutation } from '../lib/events';
import { impPairScore, project, trimScores } from '../lib/scoring';
import { publicBoards } from '../lib/public-event';
import {
  bestDeclarerTricks,
  legalCards,
  nextSeat,
  playCard,
  playFromResult,
  PlayState,
  toPbn,
} from '../lib/play';
import { tableNames } from '../lib/table-names';
import type { Result } from '../lib/model';
import { parseResultsCsv, exportResultsCsv } from '../lib/imports';
import { highCardPoints, lawOfTotalTricks } from '../lib/deal-analysis';
import { boardRounds } from '../lib/board-navigation';
import { makeBoard } from '../lib/events';

test('DD best move maximizes declarer tricks for declarer side and minimizes for defenders', () => {
  assert.equal(bestDeclarerTricks([4, 4, 5], 'N', 'N'), 5);
  assert.equal(bestDeclarerTricks([4, 4, 5], 'S', 'N'), 5);
  assert.equal(bestDeclarerTricks([4, 4, 5], 'E', 'N'), 4);
  assert.equal(bestDeclarerTricks([4, 4, 5], 'W', 'N'), 4);
  assert.equal(bestDeclarerTricks([8, 9], 'E', 'W'), 9);
  assert.equal(bestDeclarerTricks([8, 9], 'S', 'W'), 8);
  assert.equal(bestDeclarerTricks([], 'N', 'N'), undefined);
});

test('table selection maps pair names to the correct sides without inventing team lineups', () => {
  const e = event(),
    assignment = e.assignments[0];
  const ns = e.participants.find((p) => p.id === assignment.ns)!;
  const ew = e.participants.find((p) => p.id === assignment.ew)!;
  ns.name = 'North Player / South Player';
  ew.name = 'East Player／West Player';
  assert.deepEqual(tableNames('pairs', e.participants, assignment), {
    N: 'North Player',
    S: 'South Player',
    E: 'East Player',
    W: 'West Player',
  });
  ns.players = '北家、南家';
  assert.equal(tableNames('pairs', e.participants, assignment).N, '北家');
  ns.players = '';
  ns.name = '陳宥綺 黃順捷';
  ew.name = '吳承翰　江少甫';
  assert.deepEqual(tableNames('pairs', e.participants, assignment), {
    N: '陳宥綺',
    S: '黃順捷',
    E: '吳承翰',
    W: '江少甫',
  });
  ns.players = ' 陳宥綺  黃順捷 ';
  assert.equal(tableNames('pairs', e.participants, assignment).S, '黃順捷');
  ns.players = '';
  ns.name = 'Mary Smith';
  assert.equal(tableNames('pairs', e.participants, assignment).N, 'Mary Smith');
  assert.equal(tableNames('pairs', e.participants, assignment).S, 'Mary Smith');
  ns.name = 'NS Team';
  ns.players = 'A / B / C / D';
  assert.equal(tableNames('teams', e.participants, assignment).N, 'NS Team');
  assert.equal(tableNames('teams', e.participants, assignment).S, 'NS Team');
  assert.deepEqual(tableNames('pairs', e.participants), {});
});

test('a selected played contract starts with the opening leader; passes and cancellations do not', () => {
  const board = makeBoard(1);
  const result: Result = {
    assignmentId: 'a',
    board: 1,
    level: 3,
    strain: 'NT',
    doubled: 1,
    declarer: 'W',
    tricks: 9,
    lead: '',
    nsScore: -400,
    updatedAt: '',
  };
  const state = playFromResult(board, result)!;
  assert.equal(nextSeat(state), 'N');
  assert.equal(state.hands.N.length, 13);
  const next = playCard(state, legalCards(state)[0], result.strain);
  assert.equal(nextSeat(next), 'E');
  assert.equal(state.hands.N.length, 13);
  assert.equal(board.deal.N.length, 13);
  assert.equal(playFromResult(board, { ...result, level: 0 }), null);
  assert.equal(playFromResult(board, { ...result, status: 'cancelled' }), null);
  assert.equal(playFromResult(board), null);
});

test('128 boards remain directly addressable by round and within-round number', () => {
  const e = createEvent({
    name: 'World-size QA',
    kind: 'pairs',
    date: '2026-10-13',
    venue: '',
    names: ['A', 'B', 'C', 'D', 'E', 'F'],
    rounds: 4,
    boardsPerRound: 32,
  });
  const choices = boardRounds(e);
  assert.equal(choices.length, 4);
  assert.deepEqual(
    choices.map((r) => r.boards.length),
    [32, 32, 32, 32],
  );
  assert.equal(choices[3].boards[31], 128);
});
test('HCP and LoTT use the whole deal and the corresponding trump strain', () => {
  const board = makeBoard(1);
  assert.equal(
    ['N', 'E', 'S', 'W'].reduce(
      (n, seat) => n + highCardPoints(board.deal[seat as keyof typeof board.deal]),
      0,
    ),
    40,
  );
  const table = [
    [7, 6, 7, 5],
    [4, 9, 4, 9],
    [6, 7, 6, 7],
    [7, 6, 7, 6],
    [4, 9, 4, 9],
  ];
  assert.deepEqual(lawOfTotalTricks(board, table), {
    fit: 17,
    tricks: 16,
    difference: 1,
    suits: ['S', 'H'],
  });
});
function event() {
  return createEvent({
    name: 'Advanced QA',
    kind: 'pairs',
    pairMethod: 'crossimp',
    trim: 'none',
    date: '2026-10-13',
    venue: '',
    names: ['A', 'B', 'C', 'D', 'E', 'F'],
    rounds: 1,
    boardsPerRound: 2,
  });
}
test('cancelled team boards contribute no IMP and an entirely cancelled match earns no VP', () => {
  const e = createEvent({
    name: 'Team QA',
    kind: 'teams',
    date: '2026-10-13',
    venue: '',
    names: ['A', 'B', 'C', 'D'],
    rounds: 1,
    boardsPerRound: 1,
  });
  for (const a of e.assignments)
    e.results[`${a.id}:1`] = {
      assignmentId: a.id,
      board: 1,
      level: 0,
      strain: 'NT',
      doubled: 1,
      declarer: 'N',
      tricks: 0,
      lead: '',
      nsScore: 0,
      updatedAt: '',
      status: 'cancelled',
    };
  const p = project(e);
  assert.equal(p.received, p.expected);
  assert.ok(p.matches.every((m) => m.vpA === null && m.vpB === null && m.completed === 1));
  assert.ok(p.standings.every((s) => s.score === 0 && s.played === 0));
});
const meta = { revision: 1, requestId: 'test', reason: '裁判測試' };
test('CrossIMP averages pairwise IMPs and Butler uses a rounded arithmetic datum', () => {
  assert.equal(impPairScore(420, [420, 170, -50], 0, 'crossimp', 'none').value, 8);
  assert.deepEqual(impPairScore(420, [420, 170, -50], 0, 'butler', 'none'), {
    value: 6,
    datum: 180,
  });
  assert.equal(impPairScore(-20, [-20, -10], 0, 'butler', 'none').datum, -20);
  assert.equal(impPairScore(420, [420], 0, 'butler', 'none').value, null);
  assert.deepEqual(trimScores([1, 2], 'one'), [1, 2]);
  assert.deepEqual(trimScores([1, 2, 3], 'one'), [2]);
  assert.deepEqual(
    trimScores(
      Array.from({ length: 10 }, (_, i) => i),
      'ten-percent',
    ),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.equal(impPairScore(420, [420, 170, -50], 0, 'butler', 'one').datum, 170);
  assert.equal(impPairScore(420, [420, -1000, 170, 500], 0, 'crossimp', 'one').value, 6);
});
test('one board publication never exposes another board and legacy states remain readable', () => {
  const e = event(),
    s = { event: e, projection: project(e), requests: [] };
  const n = applyMutation(s, { ...meta, action: 'board-publication', board: 1, published: true });
  const visible = publicBoards(n.event);
  assert.ok('deal' in visible[0]);
  assert.ok(!('deal' in visible[1]));
  assert.ok(publicBoards(e).every((b) => !('deal' in b)));
  const legacy = { ...e, publishBoards: true };
  const hidden = applyMutation(
    { ...s, event: legacy },
    { ...meta, action: 'board-publication', board: 1, published: false },
  );
  assert.ok(!('deal' in publicBoards(hidden.event)[0]));
  assert.ok('deal' in publicBoards(hidden.event)[1]);
});
test('cancelled results are processed, excluded from comparisons, protected from ordinary writes and auditable', () => {
  const e = event(),
    a = e.assignments[0];
  const s = { event: e, projection: project(e), requests: [] };
  const n = applyMutation(s, {
    ...meta,
    action: 'ruling',
    assignmentId: a.id,
    board: 1,
    cancelled: true,
  });
  assert.equal(n.projection.received, 1);
  assert.equal(n.projection.pairScores[`${a.id}:1`].ns, null);
  assert.equal(n.projection.standings.find((p) => p.id === a.ns)!.played, 0);
  assert.equal(n.event.audit.at(-1)!.changes![0].after!.status, 'cancelled');
  const r = {
    assignmentId: a.id,
    board: 1,
    level: 3,
    strain: 'NT' as const,
    doubled: 1 as const,
    declarer: 'N' as const,
    tricks: 9,
    lead: '',
  };
  assert.throws(
    () =>
      applyMutation(n, { ...meta, requestId: 'two', revision: 2, action: 'results', results: [r] }),
    /裁判/,
  );
  assert.throws(() => parseResultsCsv(exportResultsCsv(n.event)), /裁判/);
  const restored = applyMutation(n, {
    ...meta,
    requestId: 'two',
    revision: 2,
    action: 'ruling',
    assignmentId: a.id,
    board: 1,
    cancelled: false,
    result: r,
  });
  assert.equal(restored.event.results[`${a.id}:1`].status, 'played');
  assert.equal(restored.event.results[`${a.id}:1`].nsScore, 400);
});
test('penalties subtract from aggregate, replace rather than accumulate, and negative scores rank above missing', () => {
  const e = event();
  for (const [i, a] of e.assignments.entries())
    e.results[`${a.id}:1`] = {
      assignmentId: a.id,
      board: 1,
      level: 3,
      strain: 'NT',
      doubled: 1,
      declarer: 'N',
      tricks: 9,
      lead: '',
      nsScore: [420, 170, -50][i],
      updatedAt: '',
    };
  const original = project(e),
    id = e.assignments[0].ns;
  const n = applyMutation(
    { event: e, projection: original, requests: [] },
    { ...meta, action: 'penalty', participantId: id, amount: 10 },
  );
  assert.equal(
    n.projection.standings.find((s) => s.id === id)!.score,
    original.standings.find((s) => s.id === id)!.score! - 10,
  );
  assert.deepEqual(n.event.results, e.results);
  const cleared = applyMutation(n, {
    ...meta,
    revision: 2,
    requestId: 'two',
    action: 'penalty',
    participantId: id,
    amount: 0,
  });
  assert.equal(
    cleared.projection.standings.find((s) => s.id === id)!.score,
    original.standings.find((s) => s.id === id)!.score,
  );
  delete e.results[`${e.assignments[2].id}:1`];
  const standing = project(e).standings;
  assert.ok(
    standing.findIndex((s) => s.score! < 0 && s.score !== null) <
      standing.findIndex((s) => s.score === null),
  );
});
test('interactive play enforces turns and follow suit, resolves trump winner and serializes remaining cards', () => {
  const s: PlayState = {
    hands: { N: ['SA'], E: ['S2'], S: ['H2'], W: ['SK'] },
    leader: 'N',
    trick: [],
    ns: 0,
    ew: 0,
  };
  let p = playCard(s, 'SA', 'H');
  assert.equal(nextSeat(p), 'E');
  assert.throws(() => playCard(p, 'SK', 'H'));
  p = playCard(p, 'S2', 'H');
  p = playCard(p, 'H2', 'H');
  p = playCard(p, 'SK', 'H');
  assert.equal(p.ns, 1);
  assert.equal(p.leader, 'S');
  assert.equal(p.trick.length, 0);
  assert.deepEqual(p.lastTrick, [
    { seat: 'N', card: 'SA' },
    { seat: 'E', card: 'S2' },
    { seat: 'S', card: 'H2' },
    { seat: 'W', card: 'SK' },
  ]);
  assert.equal(s.lastTrick, undefined);
  assert.deepEqual(s.hands.N, ['SA']);
  assert.equal(toPbn(s.hands), 'N:A... 2... .2.. K...');
  const follow = {
    ...s,
    leader: 'W' as const,
    trick: [{ seat: 'W' as const, card: 'S3' }],
    hands: { ...s.hands, N: ['SA', 'HA'] },
  };
  assert.deepEqual(legalCards(follow), ['SA']);
});
