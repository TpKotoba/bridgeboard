import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent } from '../lib/events';

for (const [kind, count] of [['teams', 6], ['pairs', 4], ['pairs', 5]] as const) {
  test(`${kind} with ${count} participants continues beyond one cycle with fresh boards`, () => {
    const event = createEvent({ name: '多循環測試', kind, date: '2026-08-22', venue: '', names: Array.from({ length: count }, (_, i) => `參賽者${i + 1}`), rounds: 14, boardsPerRound: 8 });
    const cycle = count % 2 ? count : count - 1;
    const active = event.assignments.filter(a => a.room !== 'closed');
    const opponents = (round: number) => active.filter(a => a.round === round).map(a => [a.ns, a.ew].sort().join('/')).sort();
    assert.equal(event.boards.length, 112);
    assert.equal(new Set(event.assignments.map(a => a.id)).size, event.assignments.length);
    for (let round = 1; round <= 14; round++) {
      const tables = active.filter(a => a.round === round);
      assert.equal(tables.length, Math.floor(count / 2));
      assert.equal(new Set(tables.flatMap(a => [a.ns, a.ew])).size, Math.floor(count / 2) * 2);
      for (const table of tables) {
        assert.notEqual(table.ns, table.ew);
        assert.deepEqual(table.boards, Array.from({ length: 8 }, (_, i) => (round - 1) * 8 + i + 1));
        if (kind === 'teams') {
          assert(Number(table.ns.slice(1)) < Number(table.ew.slice(1)), 'Lower team number is home (open NS)');
          const closed = event.assignments.find(a => a.matchId === table.matchId && a.room === 'closed')!;
          assert.equal(closed.ns, table.ew);
          assert.equal(closed.ew, table.ns);
          assert.deepEqual(closed.boards, table.boards);
        }
      }
      if (round > cycle) assert.deepEqual(opponents(round), opponents(round - cycle));
    }
    const firstCycle = active.filter(a => a.round <= cycle).map(a => [a.ns, a.ew].sort().join('/'));
    assert.equal(new Set(firstCycle).size, count * (count - 1) / 2);
  });
}
