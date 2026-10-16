import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent } from '../lib/events';
import { teamButlerStats } from '../lib/team-butler';
import { resultKey } from '../lib/model';
function fixture() {
  const e = createEvent({
    name: 'Butler 統計',
    kind: 'teams',
    names: ['A', 'B', 'C', 'D'],
    rounds: 2,
    boardsPerRound: 2,
    date: '2026-10-16',
    venue: '',
  });
  e.assignments.forEach((a, i) => {
    a.playerNames = { N: `甲${a.ns}`, S: `乙${a.ns}`, E: `甲${a.ew}`, W: `乙${a.ew}` };
    for (const board of a.boards)
      e.results[resultKey(a.id, board)] = {
        assignmentId: a.id,
        board,
        level: 1,
        strain: 'NT',
        doubled: 1,
        declarer: 'N',
        tricks: 7,
        lead: '',
        nsScore: [100, -100, 0, 0][i % 4],
        updatedAt: '',
      };
  });
  return e;
}
test('Butler uses completed rounds only, same-round datum, correct EW signs and whole-field tied ranks', () => {
  const e = fixture();
  delete e.results[resultKey(e.assignments[4].id, 3)];
  const stats = teamButlerStats(e);
  assert.deepEqual(stats.rounds, [1]);
  const pair = stats.pairs.find((r) => r.teamId === 'p1')!;
  assert.equal(pair.boards, 4);
  assert.equal(pair.total, 12);
  assert.equal(pair.average, 3);
  assert.equal(pair.mp, 24);
  assert.equal(pair.mpPercent, 100);
  assert.equal(pair.ratio, Infinity);
  assert.equal(pair.averageRank, 1);
  const individuals = stats.individual.filter((r) => r.teamId === 'p1');
  assert.equal(individuals.length, 2);
  assert.ok(individuals.every((r) => r.averageRank === 1 && r.boards === 4));
  assert.equal(stats.pairs.find((r) => r.teamId === 'p4')!.total, -12);
  // Later rounds use the same physical board numbers but cannot alter this round's datum.
  e.assignments
    .filter((a) => a.round === 2)
    .forEach((a) => {
      a.boards = [1, 2];
      for (const b of a.boards)
        e.results[resultKey(a.id, b)] = {
          ...e.results[resultKey(e.assignments[0].id, 1)],
          assignmentId: a.id,
          board: b,
          nsScore: 1000,
        };
    });
  const expanded = teamButlerStats(e).pairs.find((r) => r.teamId === 'p1')!;
  assert.equal(expanded.total, 12);
  assert.equal(expanded.boards, 8);
});
test('Cancelled counts toward round completion but not Butler or MP, missing names never become invented players', () => {
  const e = fixture();
  e.assignments = e.assignments.filter((a) => a.round === 1);
  for (const a of e.assignments) e.results[resultKey(a.id, 2)].status = 'cancelled';
  e.assignments[0].playerNames!.N = '';
  const stats = teamButlerStats(e);
  assert.deepEqual(stats.rounds, [1]);
  assert.ok(stats.missingNames > 0);
  assert.ok(stats.pairs.every((r) => r.boards <= 2));
  assert.ok(stats.individual.every((r) => r.names[0]));
  assert.equal(stats.individual.find((r) => r.teamId === 'p1' && r.names[0] === '甲p1')!.boards, 1);
  for (const a of e.assignments.slice(1)) e.results[resultKey(a.id, 1)].status = 'cancelled';
  assert.equal(teamButlerStats(e).pairs.length, 0);
});
test('split contracts use independent awards; partnership seat order and names on different teams remain distinct', () => {
  const e = fixture();
  e.assignments = e.assignments.filter((a) => a.round === 1);
  const r = e.results[resultKey(e.assignments[0].id, 1)];
  const award = (nsScore: number) => {
    const { updatedAt, ...rest } = r;
    void updatedAt;
    return { ...rest, nsScore };
  };
  r.split = { ns: award(-100), ew: award(200) };
  const stats = teamButlerStats(e);
  assert.equal(stats.pairs.find((r) => r.teamId === 'p1')!.total, 6);
  assert.equal(stats.pairs.find((r) => r.teamId === 'p4')!.total, -14);
  assert.equal(stats.pairs.filter((r) => r.teamId === 'p1').length, 1);
  e.assignments.forEach((a) => {
    a.playerNames = { N: '同名甲', S: '同名乙', E: '同名甲', W: '同名乙' };
  });
  assert.equal(teamButlerStats(e).individual.length, 8);
});
