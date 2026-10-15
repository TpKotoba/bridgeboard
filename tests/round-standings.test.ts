import test from 'node:test';
import assert from 'node:assert/strict';
import { teamStandingsThroughRound } from '../lib/scoring';

test('round VP and ranks exclude later and incomplete matches', () => {
  const event = {
    participants: ['a', 'b'].map(id => ({ id, name: id, players: '' })),
    penalties: { a: 0.2 },
    projection: { standings: [], pairScores: {}, received: 0, expected: 0, matches:
      [ [1, 8, 12], [2, 20, 0], [3, null, null] ].map(([round, vpA, vpB]) => ({
        id: String(round), round: round!, a: 'a', b: 'b', impsA: 0, impsB: 0, marginA: 0, marginB: 0, split: false, completed: 0, total: 8, vpA, vpB,
      })),
    },
  };
  assert.deepEqual(teamStandingsThroughRound(event, 1).map(r => [r.id, r.score, r.rank]), [['b', 12, 1], ['a', 7.8, 2]]);
  assert.deepEqual(teamStandingsThroughRound(event, 2).map(r => [r.id, r.score, r.rank]), [['a', 27.8, 1], ['b', 12, 2]]);
  assert.deepEqual(teamStandingsThroughRound(event, 3), teamStandingsThroughRound(event, 2));
});
