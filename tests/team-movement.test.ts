import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import { exportMovement, parseMovement } from '../lib/imports';
import { project } from '../lib/scoring';

const fixture = () => createEvent({ name: '隊制編排', kind: 'teams', names: ['A', 'B', 'C', 'D'], date: '2026-10-16', venue: '', rounds: 3, boardsPerRound: 2 });
const command = (csv: string, revision = 1) => ({ action: 'movement' as const, revision, requestId: randomUUID(), reason: '調整賽程', csv });

test('team movement exports and imports both rooms without changing their match pairing', () => {
  const event = fixture();
  const parsed = parseMovement(exportMovement(event), event);
  assert.deepEqual(parsed, event.assignments);
  const pairs = { ...event, kind: 'pairs' as const, assignments: event.assignments.filter(a => a.room === 'open').map(a => ({ ...a, room: 'pairs' as const })) };
  assert.equal(exportMovement(pairs).split('\n')[0], 'round,table,ns,ew,boards');
  assert.equal(parseMovement(exportMovement(pairs), pairs).length, pairs.assignments.length);
});

test('team movement rejects missing rooms, wrong opponents, differing boards and duplicate rooms', () => {
  const event = fixture();
  const rows = exportMovement(event).split('\n');
  for (const csv of [
    rows.filter((_, i) => i !== 2).join('\n'),
    rows.map((r, i) => i === 2 ? r.replace('"closed"', '"pairs"') : r).join('\n'),
    rows.map((r, i) => i === 2 ? r.replace('"1;2"', '"3;4"') : r).join('\n'),
    rows.map((r, i) => i === 2 ? r.replace('"p4","p1"', '"p1","p4"') : r).join('\n'),
    [...rows, rows[1]].join('\n'),
  ]) assert.throws(() => parseMovement(csv, event));
});

test('team movement imports an unscored round and preserves omitted rounds', () => {
  const event = fixture();
  const assignments = event.assignments.filter(a => a.round === 2).map(a => ({ ...a, table: `A${a.table}` }));
  const result = applyMutation({ event, projection: project(event), requests: [] }, command(exportMovement({ ...event, assignments })));
  assert.equal(result.event.assignments.length, event.assignments.length);
  assert.deepEqual(result.event.assignments.filter(a => a.round !== 2), event.assignments.filter(a => a.round !== 2));
  assert.ok(result.event.assignments.filter(a => a.round === 2).every(a => String(a.table).startsWith('A')));
});

test('scored team rounds retain result IDs and lineups and reject schedule changes atomically', () => {
  const event = fixture();
  event.assignments[0].playerNames = { N: '測試賽員' };
  let stored = { event, projection: project(event), requests: [] as string[] };
  stored = applyMutation(stored, { action: 'results', revision: 1, requestId: randomUUID(), reason: '收分測試', results: [{ assignmentId: event.assignments[0].id, board: 1, level: 4, strain: 'S', doubled: 1, declarer: 'N', tricks: 10, lead: '' }] });
  const imported = applyMutation(stored, command(exportMovement(stored.event), stored.event.revision));
  assert.deepEqual(imported.event.results, stored.event.results);
  assert.deepEqual(imported.event.assignments[0], stored.event.assignments[0]);
  const changed = { ...stored.event, assignments: stored.event.assignments.map(a => a.round === 1 ? { ...a, ns: a.ew, ew: a.ns } : a) };
  assert.throws(() => applyMutation(stored, command(exportMovement(changed), stored.event.revision)), /已有成績/);
  assert.equal(stored.event.assignments[0].ns, event.assignments[0].ns);
  const finished = { ...stored, event: { ...stored.event, status: 'finished' as const } };
  assert.throws(() => applyMutation(finished, command(exportMovement(finished.event), finished.event.revision)), /重新開放/);
});
