import test from 'node:test';
import assert from 'node:assert/strict';
import { contractScore, imps, project, vp } from '../lib/scoring';
import { applyMutation, createEvent, DomainError, seedEvents } from '../lib/events';
import { createSchema, mutationSchema, ResultInput, resultKey, resultSchema } from '../lib/model';
import {
  exportMovement,
  exportPbn,
  exportResultsCsv,
  parseMovement,
  parsePbn,
  parseResultsCsv,
} from '../lib/imports';
const base: ResultInput = {
  assignmentId: 'r1m1o',
  board: 1,
  level: 4,
  strain: 'S',
  doubled: 1,
  declarer: 'N',
  tricks: 10,
  lead: '',
};
test('duplicate contract scoring: games, slams, doubles, overtricks and penalties', () => {
  assert.equal(contractScore(base, 'None'), 420);
  assert.equal(contractScore(base, 'NS'), 620);
  assert.equal(contractScore({ ...base, declarer: 'E' }, 'EW'), -620);
  assert.equal(contractScore({ ...base, level: 3, strain: 'NT', tricks: 9 }, 'None'), 400);
  assert.equal(
    contractScore({ ...base, level: 2, strain: 'H', tricks: 8, doubled: 2 }, 'None'),
    470,
  );
  assert.equal(
    contractScore({ ...base, level: 2, strain: 'H', tricks: 9, doubled: 2 }, 'All'),
    870,
  );
  assert.equal(contractScore({ ...base, level: 6, strain: 'NT', tricks: 12 }, 'All'), 1440);
  assert.equal(contractScore({ ...base, level: 7, strain: 'NT', tricks: 13 }, 'All'), 2220);
  assert.equal(
    contractScore({ ...base, level: 1, strain: 'C', tricks: 7, doubled: 4 }, 'None'),
    230,
  );
  assert.equal(contractScore({ ...base, doubled: 2, tricks: 6 }, 'None'), -800);
  assert.equal(contractScore({ ...base, doubled: 2, tricks: 6 }, 'All'), -1100);
  assert.equal(contractScore({ ...base, doubled: 4, tricks: 8 }, 'All'), -1000);
  assert.equal(contractScore({ ...base, tricks: 8 }, 'None'), -100);
  assert.equal(contractScore({ ...base, level: 0, tricks: 0 }, 'All'), 0);
});
test('IMP thresholds include boundaries and sign', () => {
  for (const [raw, imp] of [
    [0, 0],
    [10, 0],
    [20, 1],
    [40, 1],
    [50, 2],
    [400, 9],
    [420, 9],
    [430, 10],
    [600, 12],
    [3990, 23],
    [4000, 24],
  ]) {
    assert.equal(imps(raw), imp);
    assert.equal(Math.abs(imps(-raw)), imp);
  }
});
test('WBF VP table anchors, monotonicity, concavity and symmetry', () => {
  assert.equal(vp(0, 16), 10);
  assert.equal(vp(20, 16), 15);
  assert.equal(vp(60, 16), 20);
  assert.equal(vp(-20, 16), 5);
  for (const boards of [2, 7, 8, 13, 16, 32])
    for (let m = 1; m < 100; m++) {
      assert.ok(vp(m, boards) >= vp(m - 1, boards));
      assert.ok(Math.abs(vp(m, boards) + vp(-m, boards) - 20) < 1e-8);
      assert.ok(vp(m + 1, boards) - vp(m, boards) <= vp(m, boards) - vp(m - 1, boards) + 1e-8);
    }
});
function empty(kind: 'teams' | 'pairs' = 'teams') {
  return createEvent(
    {
      name: '測試賽事',
      kind,
      date: '2026-10-12',
      venue: '',
      names: ['A', 'B', 'C', 'D'],
      rounds: 1,
      boardsPerRound: 1,
    },
    'test',
  );
}
test('team comparison reverses closed room; incomplete matches do not earn VP', () => {
  const e = empty();
  const open = e.assignments.find((a) => a.room === 'open')!,
    closed = e.assignments.find((a) => a.matchId === open.matchId && a.room === 'closed')!;
  e.results[resultKey(open.id, 1)] = {
    ...base,
    assignmentId: open.id,
    nsScore: 420,
    updatedAt: '',
  };
  let p = project(e);
  assert.equal(p.matches[0].vpA, null);
  assert.equal(p.matches[0].completed, 0);
  e.results[resultKey(closed.id, 1)] = {
    ...base,
    assignmentId: closed.id,
    nsScore: 170,
    updatedAt: '',
  };
  p = project(e);
  assert.equal(p.matches[0].impsA, 6);
  assert.equal(p.matches[0].impsB, 0);
  assert.equal(p.matches[0].completed, 1);
  assert.equal(p.standings.find((s) => s.id === open.ns)!.secondary, 6);
  // Equal physical NS scores in opposite rooms must cancel.
  e.results[resultKey(closed.id, 1)].nsScore = 420;
  assert.equal(project(e).matches[0].impsA, 0);
  e.results[resultKey(closed.id, 1)].nsScore = -170;
  assert.equal(project(e).matches[0].impsA, 11);
  // An artificial average is 0 IMP without reducing the VP board count.
  e.results[resultKey(closed.id, 1)].status = 'average';
  p = project(e);
  assert.equal(p.matches[0].impsA, 0);
  assert.equal(p.matches[0].vpA, 10);
  assert.equal(p.matches[0].completed, 1);
});
test('pairs score ties, missing results and recompute whole board on correction', () => {
  const e = empty('pairs');
  const [a, b] = e.assignments;
  e.results[resultKey(a.id, 1)] = { ...base, assignmentId: a.id, nsScore: 420, updatedAt: '' };
  let p = project(e);
  assert.equal(p.pairScores[resultKey(a.id, 1)].ns, null);
  e.results[resultKey(b.id, 1)] = { ...base, assignmentId: b.id, nsScore: 170, updatedAt: '' };
  p = project(e);
  assert.equal(p.pairScores[resultKey(a.id, 1)].ns, 2);
  assert.equal(p.pairScores[resultKey(a.id, 1)].ew, 0);
  e.results[resultKey(b.id, 1)].nsScore = 420;
  p = project(e);
  assert.equal(p.pairScores[resultKey(a.id, 1)].ns, 1);
  assert.equal(p.pairScores[resultKey(b.id, 1)].ns, 1);
  assert.ok(p.standings.every((s) => s.score === 50 && s.rank === 1));
});
test('odd pairs movement represents byes with no phantom scores', () => {
  const e = createEvent({
    name: '十五對',
    kind: 'pairs',
    date: '2026-10-12',
    venue: '',
    names: Array.from({ length: 15 }, (_, i) => String(i + 1)),
    rounds: 13,
    boardsPerRound: 2,
  });
  assert.equal(e.assignments.length, 91);
  assert.equal(project(e).expected, 182);
  for (let r = 1; r <= 13; r++)
    assert.equal(
      new Set(e.assignments.filter((a) => a.round === r).flatMap((a) => [a.ns, a.ew])).size,
      14,
    );
  const played = new Set<string>();
  for (const a of e.assignments)
    for (const id of [a.ns, a.ew])
      for (const b of a.boards) {
        const key = `${id}:${b}`;
        assert.ok(!played.has(key));
        played.add(key);
      }
});
test('atomic mutation, optimistic version check, idempotency and audit', () => {
  const e = empty(),
    stored = { event: e, projection: project(e), requests: [] };
  const command = mutationSchema.parse({
    action: 'results',
    revision: 1,
    requestId: '11111111-1111-4111-8111-111111111111',
    reason: '測試收分',
    results: [base],
  });
  if (command.action !== 'results') throw new Error('Unexpected command');
  const next = applyMutation(stored, command);
  assert.equal(next.event.revision, 2);
  assert.equal(next.event.results['r1m1o:1'].nsScore, 420);
  assert.equal(next.event.audit[1].changes![0].before, null);
  assert.equal(applyMutation(next, command), next);
  assert.throws(
    () => applyMutation(next, { ...command, requestId: '22222222-2222-4222-8222-222222222222' }),
    /更新/,
  );
  assert.equal(Object.keys(stored.event.results).length, 0);
  assert.throws(
    () => applyMutation(stored, { ...command, results: [base, { ...base, board: 2 }] }),
    /牌號/,
  );
  assert.equal(Object.keys(stored.event.results).length, 0);
});
test('invalid contracts, duplicate imports and premature finalization rejected', () => {
  assert.equal(resultSchema.safeParse({ ...base, level: 8 }).success, false);
  assert.equal(resultSchema.safeParse({ ...base, level: 0, tricks: 4 }).success, false);
  assert.equal(
    createSchema.safeParse({
      name: 'Test',
      kind: 'teams',
      date: '2026-10-12',
      venue: '',
      names: ['a', 'b', 'c', 'd', 'e'],
      rounds: 1,
      boardsPerRound: 8,
    }).success,
    false,
  );
  const e = empty(),
    stored = { event: e, projection: project(e), requests: [] };
  assert.throws(
    () =>
      applyMutation(stored, {
        action: 'settings',
        revision: 1,
        requestId: 'x',
        reason: 'test',
        status: 'finished',
        publishBoards: false,
      }),
    /未收齊/,
  );
  assert.throws(
    () =>
      applyMutation(stored, {
        action: 'results',
        revision: 1,
        requestId: 'x',
        reason: 'test',
        results: [base, base],
      }),
    /重複/,
  );
});
test('PBN export round-trip validates all 52 cards and rejects duplicates', () => {
  const e = seedEvents()[0].event,
    pbn = exportPbn(e),
    boards = parsePbn(pbn);
  assert.equal(boards.length, e.boards.length);
  for (const b of boards) assert.equal(new Set(Object.values(b.deal).flat()).size, 52);
  assert.throws(
    () =>
      parsePbn(
        '[Board "1"]\n[Dealer "N"]\n[Vulnerable "None"]\n[Deal "N:AKQJT98765432... AKQJT98765432... AKQJT98765432... AKQJT98765432..."]',
      ),
    /重複/,
  );
});
test('CSV score and movement exports round-trip; duplicate seats rejected', () => {
  const e = seedEvents()[1].event;
  assert.equal(parseResultsCsv(exportResultsCsv(e)).length, Object.keys(e.results).length);
  const movement = exportMovement(e);
  assert.equal(parseMovement(movement, e).length, e.assignments.length);
  assert.throws(
    () => parseMovement('round,table,ns,ew,boards\n1,1,p1,p2,1;2\n1,2,p1,p3,1;2', e),
    /多桌/,
  );
  assert.throws(
    () => parseResultsCsv('assignmentId,board,level,strain,doubled,declarer,tricks\na,1,,NT,1,N,0'),
    /不可空白/,
  );
});
test('invalid import returns a client error without changing stored data', () => {
  const event = empty('pairs');
  const stored = { event, projection: project(event), requests: [] };
  for (const action of [
    { action: 'pbn' as const, pbn: 'invalid' },
    { action: 'movement' as const, csv: 'invalid' },
  ]) {
    assert.throws(
      () =>
        applyMutation(stored, { ...action, revision: 1, requestId: 'test', reason: '測試匯入' }),
      (error: unknown) => error instanceof DomainError && error.status === 400,
    );
  }
  assert.equal(event.revision, 1);
  assert.equal(event.audit.length, 1);
});
test('event dates reject impossible calendar days', () => {
  const input = {
    name: '日期測試',
    kind: 'pairs',
    venue: '',
    names: ['A', 'B', 'C', 'D'],
    rounds: 1,
    boardsPerRound: 1,
  };
  assert.equal(createSchema.safeParse({ ...input, date: '2026-02-30' }).success, false);
  assert.equal(createSchema.safeParse({ ...input, date: '2028-02-29' }).success, true);
});
