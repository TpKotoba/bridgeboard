import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseRoundTimes, exportRoundTimes } from '../lib/round-times-import';
import { createEvent, applyMutation } from '../lib/events';
import { project } from '../lib/scoring';

test('round times import updates atomically, preserves omitted rounds and supports explicit clearing', () => {
  const event = createEvent({ name: '時間匯入', kind: 'pairs', names: ['A', 'B', 'C', 'D'], date: '2026-10-16', venue: '', rounds: 3, boardsPerRound: 2 });
  event.roundTimes = { 3: { startAt: '2026-10-16T03:00:00.000Z', endAt: '2026-10-16T03:30:00.000Z' } };
  const stored = { event, projection: project(event), requests: [] };
  const command = { action: 'round-times-import' as const, revision: 1, requestId: randomUUID(), reason: '匯入時間表', csv: 'round,startAt,endAt\n1,09:00,09:30\n2,2026-10-16 23:45,2026-10-17 00:15' };
  const result = applyMutation(stored, command);
  assert.equal(result.event.roundTimes?.[1].startAt, '2026-10-16T01:00:00.000Z');
  assert.equal(result.event.roundTimes?.[2].endAt, '2026-10-16T16:15:00.000Z');
  assert.deepEqual(result.event.roundTimes?.[3], event.roundTimes[3]);
  assert.equal(result.event.currentRound, event.currentRound);
  assert.equal(parseRoundTimes(exportRoundTimes(result.event), event).length, 3);
  const cleared = applyMutation(result, { ...command, revision: 2, requestId: randomUUID(), csv: 'round,startAt,endAt\n1,,' });
  assert.equal(cleared.event.roundTimes?.[1], undefined);
  assert.ok(cleared.event.roundTimes?.[2]);
  for (const row of ['1,09:00,', '1,10:00,09:00', '4,09:00,10:00', '1,2026-02-30 09:00,2026-03-01 10:00', '1,25:00,26:00', '1,09:00,10:00\n1,10:00,11:00']) {
    assert.throws(() => applyMutation(stored, { ...command, csv: `round,startAt,endAt\n2,08:00,08:30\n${row}` }));
    assert.deepEqual(Object.keys(stored.event.roundTimes!), ['3']);
  }
});
