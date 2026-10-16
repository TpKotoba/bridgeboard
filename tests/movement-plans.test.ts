import test from 'node:test';
import assert from 'node:assert/strict';
import { movementOptions, buildMovement } from '../lib/movement-plans';
import { createEvent, applyMutation } from '../lib/events';
import { exportMovement, parseMovement } from '../lib/imports';
import { project } from '../lib/scoring';
import { randomUUID } from 'node:crypto';

test('copies count peak simultaneous board use, excluding phantom tables', () => {
  const event = createEvent({ name: 'Movement test', kind: 'pairs', names: Array.from({ length: 12 }, (_, i) => `Pair ${i + 1}`), date: '2026-10-16', venue: '', rounds: 6, boardsPerRound: 2 });
  assert.equal(buildMovement(event, 'barometer').copies, 6);
  assert.equal(buildMovement(event, 'mitchell-relay').copies, 2);
  assert.equal(buildMovement({ ...event, rounds: 5 }, 'mitchell').copies, 1);
  assert.equal(buildMovement({ ...event, participants: event.participants.slice(0, 11) }, 'barometer').copies, 5);
  assert.equal(buildMovement({ ...event, participants: event.participants.slice(0, 6), rounds: 5 }, 'howell-3-5').copies, 3);
});

test('every offered movement has complete rounds and no repeated boards for any pair', () => {
  for (let pairs = 4; pairs <= 20; pairs++) for (let rounds = 1; rounds <= 15; rounds++) {
    const event = createEvent({ name: 'Movement test', kind: 'pairs', names: Array.from({ length: pairs }, (_, i) => `Pair ${i + 1}`), date: '2026-10-16', venue: '', rounds, boardsPerRound: 2 });
    for (const option of movementOptions(event)) {
      const stored = applyMutation({ event, requests: [], projection: project(event) }, { action: 'movement-plan', plan: option.id, revision: 1, requestId: randomUUID(), reason: 'Test movement' });
      assert.equal(parseMovement(exportMovement(stored.event), stored.event).length, Math.floor(pairs / 2) * rounds, `${pairs} pairs, ${rounds} rounds: ${option.id}`);
      if (option.id.startsWith('howell')) {
        const opponents = new Set<string>();
        for (const a of buildMovement(event, option.id).assignments) {
          const key = [a.ns, a.ew].sort().join(':');
          assert.ok(!opponents.has(key), `repeated opponents: ${option.id}`);
          opponents.add(key);
        }
      }
    }
  }
});

test('movement application protects recorded results and rejects inapplicable plans', () => {
  const event = createEvent({ name: 'Movement test', kind: 'pairs', names: ['A', 'B', 'C', 'D', 'E', 'F'], date: '2026-10-16', venue: '', rounds: 3, boardsPerRound: 2 });
  const command = { action: 'movement-plan' as const, plan: 'mitchell', revision: 1, requestId: randomUUID(), reason: 'Test movement' };
  event.results['r1m1o:1'] = { assignmentId: 'r1m1o', board: 1, level: 0, strain: 'NT', doubled: 1, declarer: 'N', tricks: 0, lead: '', nsScore: 0, updatedAt: '', status: 'cancelled' };
  assert.throws(() => applyMutation({ event, requests: [], projection: project(event) }, command), /尚未收分/);
  event.results = {}; event.status = 'finished';
  assert.throws(() => applyMutation({ event, requests: [], projection: project(event) }, command), /尚未收分/);
  assert.throws(() => buildMovement(event, 'howell-6-8'), /不適用/);
});
