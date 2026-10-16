import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import { exportLineups, parseLineups } from '../lib/lineup-import';
import { mutationSchema, resultKey } from '../lib/model';
import { project } from '../lib/scoring';
function fixture() {
  const event = createEvent({
    name: '入座與清分',
    kind: 'teams',
    names: ['A', 'B', 'C', 'D'],
    rounds: 1,
    boardsPerRound: 1,
    date: '2026-10-16',
    venue: '',
  });
  event.participants.forEach((p) => {
    p.players = ['甲', '乙', '丙', '丁'].map((n) => p.id + n).join('、');
  });
  for (const a of event.assignments)
    a.playerNames = {
      N: a.ns + (a.room === 'open' ? '甲' : '丙'),
      S: a.ns + (a.room === 'open' ? '乙' : '丁'),
      E: a.ew + (a.room === 'open' ? '甲' : '丙'),
      W: a.ew + (a.room === 'open' ? '乙' : '丁'),
    };
  return { event, projection: project(event), requests: [] as string[] };
}
const command = (action: string, extra: object, revision = 1) =>
  mutationSchema.parse({ action, revision, requestId: randomUUID(), reason: '測試操作', ...extra });
test('lineup CSV round-trips, supports partial updates and atomic room swaps', () => {
  const stored = fixture();
  assert.equal(parseLineups(exportLineups(stored.event), stored.event).length, 4);
  const [open, closed] = stored.event.assignments;
  const csv = `assignmentId,N,E,S,W\n${open.id},${closed.playerNames!.E},${open.playerNames!.E},${closed.playerNames!.W},${open.playerNames!.W}\n${closed.id},${closed.playerNames!.N},${open.playerNames!.N},${closed.playerNames!.S},${open.playerNames!.S}`;
  const swapped = applyMutation(stored, command('lineups-import', { csv }));
  assert.equal(swapped.event.assignments[0].playerNames!.N, closed.playerNames!.E);
  assert.deepEqual(swapped.event.assignments.slice(2), stored.event.assignments.slice(2));
  const cleared = applyMutation(
    swapped,
    command('lineups-import', { csv: `assignmentId,N,E,S,W\n${open.id},,,,` }, 2),
  );
  assert.deepEqual(cleared.event.assignments[0].playerNames, { N: '', E: '', S: '', W: '' });
  assert.match(cleared.event.audit.at(-1)!.detail!, /→/);
});
test('lineup CSV rejects foreign names, duplicate seats, missing headers and conflicting retained tables', () => {
  const stored = fixture();
  const [a, b] = stored.event.assignments;
  for (const csv of [
    `assignmentId,N,E,S,W\n${a.id},不存在,,,`,
    `assignmentId,N,E,S,W\n${a.id},${a.playerNames!.N},,${a.playerNames!.N},`,
    `assignmentId,N,E,S,W\n${a.id},${b.playerNames!.E},,,`,
    `assignmentId,N\n${a.id},`,
    `assignmentId,N,E,S,W\nmissing,,,,`,
    `assignmentId,N,E,S,W\n${a.id},,,,\n${a.id},,,,`,
  ]) {
    assert.throws(() => applyMutation(stored, command('lineups-import', { csv })));
    assert.equal(stored.event.revision, 1);
  }
});
test('clear results resets all score state with name and revision protection while retaining event setup and audit', () => {
  const stored = fixture(),
    e = stored.event;
  for (const a of e.assignments)
    e.results[resultKey(a.id, 1)] = {
      assignmentId: a.id,
      board: 1,
      level: 0,
      strain: 'NT',
      doubled: 1,
      declarer: 'N',
      tricks: 0,
      lead: '',
      nsScore: 0,
      status: 'cancelled',
      updatedAt: '',
    };
  e.stageName = '決賽';
  e.status = 'finished';
  e.penalties = { p1: 3 };
  e.currentRound = 1;
  e.roundPhase = 'break';
  e.club = {
    enabled: true,
    tokens: { p1: 'token' },
    confirmations: { '1:p1': { at: '', forced: true } },
    finalized: [1],
  };
  assert.throws(
    () => applyMutation(stored, command('clear-results', { confirmName: e.name })),
    /名稱/,
  );
  assert.throws(
    () => applyMutation(stored, command('clear-results', { confirmName: '決賽' }, 2)),
    /更新/,
  );
  const cmd = command('clear-results', { confirmName: '決賽' });
  const cleared = applyMutation(stored, cmd);
  assert.deepEqual(cleared.event.results, {});
  assert.deepEqual(cleared.event.penalties, {});
  assert.equal(cleared.event.status, 'live');
  assert.equal(cleared.event.currentRound, 0);
  assert.deepEqual(cleared.event.club!.confirmations, {});
  assert.deepEqual(cleared.event.club!.finalized, []);
  assert.deepEqual(cleared.event.club!.tokens, e.club.tokens);
  assert.deepEqual(cleared.event.assignments, e.assignments);
  assert.deepEqual(cleared.event.boards, e.boards);
  assert.equal(cleared.event.audit.length, e.audit.length + 1);
  assert.equal(cleared.event.audit.at(-1)!.changes!.length, 4);
  assert.ok(cleared.event.audit.at(-1)!.changes!.every((c) => c.before && c.after === null));
  assert.equal(cleared.projection.received, 0);
  assert.deepEqual(applyMutation(cleared, cmd), cleared);
  assert.equal(Object.keys(e.results).length, 4);
});
