import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import {
  project,
  teamBoardImps,
  vp,
  awardedResult,
  teamStandingsThroughRound,
} from '../lib/scoring';
import { mutationSchema, resultKey, type ResultInput, type Mutation } from '../lib/model';
import { exportResultsCsv, parseResultsCsv } from '../lib/imports';

function fixture(kind: 'teams' | 'pairs' = 'teams') {
  const event = createEvent({
    name: 'Split test',
    kind,
    names: ['A', 'B', 'C', 'D'],
    rounds: 1,
    boardsPerRound: 2,
    date: '2026-10-16',
    venue: '',
  });
  event.boards.forEach((b) => (b.vulnerability = 'None'));
  let stored = { event, projection: project(event), requests: [] as string[] };
  const input = (assignmentId: string, board: number, tricks = 10): ResultInput => ({
    assignmentId,
    board,
    level: 4,
    strain: 'H',
    doubled: 1,
    declarer: 'N',
    tricks,
    lead: '',
  });
  const mutate = (payload: Record<string, unknown>) => {
    const command = mutationSchema.parse({
      revision: stored.event.revision,
      requestId: randomUUID(),
      reason: '測試判罰',
      ...payload,
    });
    stored = applyMutation(stored, command);
    return stored;
  };
  mutate({
    action: 'results',
    results: event.assignments.flatMap((a) => a.boards.map((b) => input(a.id, b))),
  });
  const open = event.assignments.find((a) => a.room === 'open') ?? event.assignments[0];
  const closed = event.assignments.find((a) => a.matchId === open.matchId && a.room === 'closed')!;
  const split = (id = open.id) => ({
    action: 'split-contract',
    assignmentId: id,
    board: 1,
    contracts: { ns: input(id, 1, 9), ew: input(id, 1, 11) },
  });
  return {
    get stored() {
      return stored;
    },
    mutate,
    input,
    open,
    closed,
    split,
  };
}

test('split awards independently produce two negative IMP margins and VP total below 20', () => {
  const f = fixture();
  assert.equal(f.stored.projection.matches[0].vpA, 10);
  const s = f.mutate(f.split());
  const m = s.projection.matches.find((m) => m.id === f.open.matchId)!;
  assert.equal(m.marginA, -10); // NS -50 against the other room +420
  assert.equal(m.marginB, -1); // other room +420 against EW-awarded +450
  assert.equal(m.vpA, vp(-10, 2));
  assert.equal(m.vpB, vp(-1, 2));
  assert.ok(m.vpA! + m.vpB! < 20);
  assert.equal(s.projection.standings.find((r) => r.id === m.a)!.secondary, -10);
  assert.equal(
    teamStandingsThroughRound({ ...s.event, projection: s.projection }, 1).find(
      (r) => r.id === m.b,
    )!.score,
    m.vpB,
  );
  const r = s.event.results[resultKey(f.open.id, 1)];
  assert.equal(r.nsScore, 420); // actual result is preserved
  assert.equal(awardedResult(r, 'ns')!.nsScore, -50);
  assert.equal(awardedResult(r, 'ew')!.nsScore, 450);
  assert.ok(s.event.audit.at(-1)!.changes![0].after!.split);
});

test('closed-room split uses reversed team perspectives and both-room rulings combine', () => {
  const f = fixture();
  f.mutate(f.split(f.closed.id));
  let m = f.stored.projection.matches.find((m) => m.id === f.open.matchId)!;
  assert.equal(m.marginA, -1);
  assert.equal(m.marginB, -10);
  f.mutate(f.split());
  m = f.stored.projection.matches.find((m) => m.id === f.open.matchId)!;
  assert.deepEqual([m.marginA, m.marginB], [-11, -11]);
  const x = f.stored.event.results[resultKey(f.open.id, 1)];
  const y = f.stored.event.results[resultKey(f.closed.id, 1)];
  assert.deepEqual(teamBoardImps(x, y), [-11, -11]);
  assert.deepEqual(teamBoardImps({ ...x, status: 'cancelled' }, y), [0, 0]);
});

test('ruling removal restores scoring, normal writes and cancellation cannot erase awards', () => {
  const f = fixture();
  f.mutate(f.split());
  assert.throws(() => f.mutate({ action: 'results', results: [f.input(f.open.id, 1)] }), /撤銷/);
  assert.throws(
    () => f.mutate({ action: 'ruling', assignmentId: f.open.id, board: 1, cancelled: true }),
    /撤銷/,
  );
  const csv = exportResultsCsv(f.stored.event);
  assert.ok(csv.includes('splitNS,splitEW'));
  assert.throws(() => parseResultsCsv(csv), /不平衡合約/);
  f.mutate({ ...f.split(), contracts: null });
  const m = f.stored.projection.matches.find((m) => m.id === f.open.matchId)!;
  assert.equal(m.split, false);
  assert.deepEqual([m.vpA, m.vpB], [10, 10]);
  f.mutate({ action: 'ruling', assignmentId: f.open.id, board: 1, cancelled: true });
  assert.throws(() => f.mutate(f.split()), /恢復/);
});

test('split validates kind, assignment, contract identity, revision and finished status', () => {
  const pairs = fixture('pairs');
  assert.throws(() => pairs.mutate(pairs.split()), /隊伍賽/);
  const f = fixture();
  assert.throws(() => f.mutate({ ...f.split(), board: 128 }), /桌次/);
  assert.throws(
    () =>
      f.mutate({
        ...f.split(),
        contracts: { ns: f.input(f.closed.id, 1), ew: f.input(f.open.id, 1) },
      }),
    /不符/,
  );
  assert.throws(() => f.mutate({ ...f.split(), revision: 0 }));
  assert.throws(() =>
    mutationSchema.parse({
      ...f.split(),
      revision: 1,
      requestId: randomUUID(),
      reason: '測試',
      contracts: { ns: { ...f.input(f.open.id, 1), tricks: 14 }, ew: f.input(f.open.id, 1) },
    }),
  );
  const finished = structuredClone(f.stored);
  finished.event.status = 'finished';
  assert.throws(
    () =>
      applyMutation(finished, {
        ...f.split(),
        revision: finished.event.revision,
        requestId: randomUUID(),
        reason: '測試',
      } as Mutation),
    /重新開放/,
  );
});
