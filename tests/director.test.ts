import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent, applyMutation, makeBoard } from '../lib/events';
import { project } from '../lib/scoring';
import { parseMovement, exportPbn, parsePbn } from '../lib/imports';
import { boardGroups, boardRange } from '../lib/board-groups';
import { publicBoards } from '../lib/public-event';
import type { StoredEvent, Mutation } from '../lib/model';
import { mutationSchema } from '../lib/model';
import { allRoundsComplete, roundProgress } from '../lib/round-progress';

test('completion requires all scheduled rounds, not only the last round', () => {
  const s = setup();
  for (const round of [3, 1, 2]) {
    for (const a of s.stored.event.assignments.filter(a => a.round === round))
      for (const board of a.boards)
        s.apply({ action: 'ruling', assignmentId: a.id, board, cancelled: true });
    assert.equal(allRoundsComplete(s.stored.event), round === 2);
  }
  const e = structuredClone(s.stored.event);
  e.assignments = e.assignments.filter(a => a.round !== 1);
  assert.equal(allRoundsComplete(e), false);
});

function setup() {
  const event = createEvent({
    name: 'Director test',
    kind: 'pairs',
    pairMethod: 'butler',
    date: '2026-10-14',
    venue: '',
    names: ['A', 'B', 'C', 'D'],
    rounds: 3,
    boardsPerRound: 2,
  });
  event.boards = event.boards.map((b) => makeBoard(b.number));
  let stored: StoredEvent = { event, projection: project(event), requests: [] };
  return {
    get stored() {
      return stored;
    },
    apply(payload: object) {
      stored = applyMutation(stored, {
        ...payload,
        revision: stored.event.revision,
        requestId: `request-${stored.event.revision}`,
        reason: '測試',
      } as Mutation);
      return stored;
    },
  };
}
const header = 'round,table,ns,ew,boards\n';
test('maximum displayed board number persists without modifying board IDs or results', () => {
  const s = setup();
  const before = structuredClone(s.stored.event.boards);
  s.apply({ action: 'settings', status: 'live', maxBoardNumber: 16 });
  assert.equal(s.stored.event.maxBoardNumber, 16);
  assert.deepEqual(s.stored.event.boards, before);
  assert.deepEqual(s.stored.event.results, {});
  assert.equal(mutationSchema.safeParse({ action: 'settings', status: 'live', maxBoardNumber: -1, revision: 1, requestId: '00000000-0000-4000-8000-000000000001', reason: 'test' }).success, false);
});
test('imported results imply a progress round when no round has been selected', () => {
  const s = setup();
  const a = s.stored.event.assignments.find(a => a.round === 3)!;
  s.apply({ action: 'results', results: [{ assignmentId: a.id, board: a.boards[0], level: 0, strain: 'NT', doubled: 1, declarer: 'N', tricks: 0, lead: '' }] });
  assert.equal(roundProgress(s.stored.event).round, 3);
  assert.equal(roundProgress(s.stored.event).received, 1);
  s.apply({ action: 'round-control', round: 1, phase: 'playing' });
  assert.equal(roundProgress(s.stored.event).round, 1);
});
const first = header + '1,A1,p1,p2,1;2\n1,2o,p3,p4,1;2';

test('Swiss movement accepts complete individual rounds and preserves scored rounds and result IDs', () => {
  const s = setup();
  s.apply({ action: 'movement', csv: first });
  assert.equal(s.stored.event.assignments.length, 2);
  assert.throws(() => s.apply({ action: 'settings', status: 'finished' }), /未安排/);
  s.apply({
    action: 'results',
    results: [
      {
        assignmentId: 'r1tA1',
        board: 1,
        level: 3,
        strain: 'NT',
        doubled: 1,
        declarer: 'N',
        tricks: 9,
        lead: '',
      },
    ],
  });
  const result = s.stored.event.results['r1tA1:1'];
  s.apply({ action: 'movement', csv: header + '2,A1,p1,p3,3;4\n2,2o,p2,p4,3;4' });
  assert.equal(s.stored.event.assignments.length, 4);
  assert.deepEqual(s.stored.event.results['r1tA1:1'], result);
  s.apply({ action: 'movement', csv: first });
  assert.deepEqual(s.stored.event.results['r1tA1:1'], result);
  const before = structuredClone(s.stored);
  assert.throws(
    () => s.apply({ action: 'movement', csv: header + '1,A1,p1,p3,1;2\n1,2o,p2,p4,1;2' }),
    /已有成績/,
  );
  assert.throws(
    () => s.apply({ action: 'movement', csv: header + '3,A1,p1,p4,1;2\n3,2o,p2,p3,1;2' }),
    /重複打/,
  );
  assert.deepEqual(s.stored, before);
  assert.throws(() => parseMovement(header + '3,A1,p1,p4,5;6', s.stored.event), /不完整/);
});

test('first custom movement import retains already scored default assignments', () => {
  const s = setup();
  const a = s.stored.event.assignments[0];
  s.apply({
    action: 'results',
    results: [
      {
        assignmentId: a.id,
        board: a.boards[0],
        level: 3,
        strain: 'NT',
        doubled: 1,
        declarer: 'N',
        tricks: 9,
        lead: '',
      },
    ],
  });
  s.apply({ action: 'movement', csv: header + '2,A1,p1,p3,3;4\n2,2o,p2,p4,3;4' });
  assert.ok(s.stored.event.assignments.some((item) => item.id === a.id));
  assert.ok(s.stored.event.results[`${a.id}:1`]);
  assert.equal(s.stored.event.assignments.length, 4);
});

test('PBN automatically groups unlabelled boards and publication is atomic for each group', () => {
  const s = setup();
  s.apply({ action: 'pbn', pbn: exportPbn(s.stored.event) });
  assert.deepEqual(
    boardGroups(s.stored.event.boards, 2).map((group) => group.map((b) => b.number)),
    [
      [1, 2],
      [3, 4],
      [5, 6],
    ],
  );
  s.apply({ action: 'board-publication', board: 1, published: true });
  assert.deepEqual(
    publicBoards(s.stored.event).map((b) => 'deal' in b),
    [true, true, false, false, false, false],
  );
  s.apply({ action: 'board-publication', board: 2, published: false });
  assert.ok(publicBoards(s.stored.event).every((b) => !('deal' in b)));
  assert.deepEqual(
    parsePbn(exportPbn(s.stored.event)).map((b) => b.group),
    s.stored.event.boards.map((b) => b.group),
  );
});

test('explicit PBN groups can span nonconsecutive boards and stay separate from defaults', () => {
  const s = setup();
  s.stored.event.boards[0].group = 'Auto-1';
  s.stored.event.boards[3].group = 'Auto-1';
  s.apply({ action: 'pbn', pbn: exportPbn(s.stored.event) });
  s.apply({ action: 'board-publication', board: 4, published: true });
  assert.deepEqual(
    publicBoards(s.stored.event).map((b) => 'deal' in b),
    [true, false, false, true, false, false],
  );
  assert.equal(boardRange([18, 16, 17, 13, 14, 22]), '13,14,16-18,22');
});

test('award settings preserve scores and zero disables awards', () => {
  const s = setup();
  const before = s.stored.projection;
  s.apply({ action: 'settings', status: 'live', awardPlaces: 5 });
  assert.equal(s.stored.event.awardPlaces, 5);
  assert.deepEqual(s.stored.projection, before);
  s.apply({ action: 'settings', status: 'live', awardPlaces: 0 });
  assert.equal(s.stored.event.awardPlaces, 0);
});

test('event prefix and short name remain separate and can be updated without changing results', () => {
  const s = setup();
  const projection = structuredClone(s.stored.projection);
  s.apply({ action: 'settings', status: 'live', prefix: '臺灣大學橋藝社 114-1', name: '老少盃' });
  assert.equal(s.stored.event.prefix, '臺灣大學橋藝社 114-1');
  assert.equal(s.stored.event.name, '老少盃');
  assert.deepEqual(s.stored.projection, projection);
  s.apply({ action: 'settings', status: 'live', prefix: '' });
  assert.equal(s.stored.event.prefix, '');
});

test('director can set current round and break state without changing score projections', () => {
  const s = setup();
  const projection = structuredClone(s.stored.projection);
  s.apply({ action: 'round-control', round: 2, phase: 'playing' });
  assert.equal(s.stored.event.currentRound, 2);
  assert.equal(s.stored.event.roundPhase, 'playing');
  s.apply({ action: 'round-control', round: 2, phase: 'break' });
  assert.equal(s.stored.event.roundPhase, 'break');
  assert.deepEqual(s.stored.projection, projection);
  assert.throws(() => s.apply({ action: 'round-control', round: 4, phase: 'playing' }), /範圍/);
  s.apply({ action: 'round-control', round: 0, phase: 'playing' });
  assert.equal(s.stored.event.currentRound, 0);
});

test('Swiss unassigned rounds cannot be selected as current and invalid changes are atomic', () => {
  const s = setup();
  s.apply({ action: 'movement', csv: first });
  const before = structuredClone(s.stored);
  assert.throws(() => s.apply({ action: 'round-control', round: 2, phase: 'playing' }), /安排/);
  assert.deepEqual(s.stored, before);
});

test('round timing requires a valid interval, preserves other rounds and supports clearing', () => {
  const s = setup();
  const timing = { startAt: '2026-10-14T10:00:00+08:00', endAt: '2026-10-14T10:30:00+08:00' };
  s.apply({ action: 'round-timing', round: 1, ...timing });
  s.apply({ action: 'round-timing', round: 2, ...timing });
  assert.deepEqual(s.stored.event.roundTimes?.[1], timing);
  const before = structuredClone(s.stored);
  assert.throws(
    () => s.apply({ action: 'round-timing', round: 2, ...timing, endAt: timing.startAt }),
    /晚於/,
  );
  assert.throws(
    () => s.apply({ action: 'round-timing', round: 2, ...timing, endAt: null }),
    /一起/,
  );
  assert.deepEqual(s.stored, before);
  s.apply({ action: 'round-timing', round: 2, startAt: null, endAt: null });
  assert.equal(s.stored.event.roundTimes?.[2], undefined);
  assert.deepEqual(s.stored.event.roundTimes?.[1], timing);
  assert.equal(
    mutationSchema.safeParse({
      action: 'round-timing',
      round: 1,
      startAt: 'invalid',
      endAt: null,
      revision: 1,
      reason: '測試',
      requestId: '11111111-1111-4111-8111-111111111111',
    }).success,
    false,
  );
});

test('dashboard counts only current round, includes handled cancellations and reports all slowest ties', () => {
  const s = setup();
  assert.deepEqual(roundProgress(s.stored.event), {
    round: 0,
    received: 0,
    expected: 0,
    slowest: [],
  });
  s.apply({ action: 'round-control', round: 1, phase: 'playing' });
  assert.equal(roundProgress(s.stored.event).slowest.length, 2);
  const firstTable = s.stored.event.assignments.find((a) => a.round === 1)!;
  s.apply({ action: 'ruling', assignmentId: firstTable.id, board: 1, cancelled: true });
  const second = s.stored.event.assignments.find((a) => a.round === 2)!;
  s.apply({ action: 'ruling', assignmentId: second.id, board: 3, cancelled: true });
  const progress = roundProgress(s.stored.event);
  assert.equal(progress.received, 1);
  assert.equal(progress.expected, 4);
  assert.equal(progress.slowest.length, 1);
  assert.notEqual(progress.slowest[0].assignment.id, firstTable.id);
  for (const a of s.stored.event.assignments.filter((a) => a.round === 1)) {
    for (const board of a.boards)
      s.apply({ action: 'ruling', assignmentId: a.id, board, cancelled: true });
  }
  const complete = roundProgress(s.stored.event);
  assert.equal(complete.received, 4);
  assert.equal(complete.slowest.length, 0);
  assert.equal(s.stored.event.currentRound, 1);
  assert.equal(s.stored.event.roundPhase, 'break');
  s.apply({ action: 'round-control', round: 2, phase: 'playing' });
  assert.equal(s.stored.event.currentRound, 2);
  assert.equal(s.stored.event.roundPhase, 'playing');
});
