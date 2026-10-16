import test from 'node:test';
import assert from 'node:assert/strict';
import { randomDeals } from '../lib/random-deals';
import { makeBoard } from '../lib/events';
import { exportPbn, parsePbn } from '../lib/imports';

test('random deals contain 52 distinct cards and survive PBN round trip', () => {
  const original = Array.from({ length: 32 }, (_, i) => makeBoard(i + 1));
  const copy = structuredClone(original);
  const generated = randomDeals(original);
  for (const [index, board] of generated.entries()) {
    assert.equal(new Set(Object.values(board.deal).flat()).size, 52);
    assert.ok(Object.values(board.deal).every(hand => hand.length === 13));
    assert.equal(board.number, original[index].number);
    assert.equal(board.dealer, original[index].dealer);
    assert.equal(board.vulnerability, original[index].vulnerability);
  }
  assert.deepEqual(original, copy);
  assert.equal(exportPbn({ boards: parsePbn(exportPbn({ boards: generated })) }), exportPbn({ boards: generated }));
  assert.notDeepEqual(randomDeals(original), generated);
});
