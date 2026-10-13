import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent, applyMutation, makeBoard } from '../lib/events';
import { project } from '../lib/scoring';
import { parseMovement, exportPbn, parsePbn } from '../lib/imports';
import { boardGroups, boardRange } from '../lib/board-groups';
import { publicBoards } from '../lib/public-event';
import type { StoredEvent, Mutation } from '../lib/model';

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
