import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBoard } from '../lib/events';
import { seats } from '../lib/model';
import { perspectiveHighCardPoints } from '../lib/deal-analysis';
import { initialPlay, legalCards, playCard, rewindToCard, visibleHandSeats } from '../lib/play';

test('hidden hand points accumulate only exposed cards and rewind with remaining hands', () => {
  const cards = ['SA', 'HK', 'DQ', 'CJ', 'S2'];
  assert.equal(perspectiveHighCardPoints(cards, undefined, false), null);
  assert.equal(perspectiveHighCardPoints(cards, cards, false), null);
  assert.equal(perspectiveHighCardPoints(cards, cards.slice(0, 4), false), 0);
  assert.equal(perspectiveHighCardPoints(cards, cards.slice(1), false), 4);
  assert.equal(perspectiveHighCardPoints(cards, cards.slice(2), false), 7);
  assert.equal(perspectiveHighCardPoints(cards, cards.slice(3), false), 9);
  assert.equal(perspectiveHighCardPoints(cards, [], false), 10);
  assert.equal(perspectiveHighCardPoints(cards, cards.slice(1), false), 4);
  assert.equal(perspectiveHighCardPoints(cards, cards, false), null);
  assert.equal(perspectiveHighCardPoints(cards, cards.slice(2), true), 10);
  assert.equal(perspectiveHighCardPoints(cards, undefined, true), 10);
});

test('each perspective shows only itself before opening lead, and itself plus dummy afterwards', () => {
  const board = makeBoard(1);
  for (const declarer of seats) {
    const initial = initialPlay(board, declarer);
    const card = legalCards(initial)[0];
    const led = playCard(initial, card, 'NT');
    const dummy = seats[(seats.indexOf(declarer) + 2) % 4];
    for (const perspective of seats) {
      assert.deepEqual(visibleHandSeats(perspective, declarer), [perspective]);
      assert.deepEqual(visibleHandSeats(perspective, declarer, initial), [perspective]);
      assert.deepEqual(new Set(visibleHandSeats(perspective, declarer, led)), new Set([perspective, dummy]));
    }
    assert.deepEqual(visibleHandSeats(null, declarer, led), [...seats]);
    const restored = rewindToCard([initial, led], initial.leader, card).at(-1)!;
    assert.deepEqual(visibleHandSeats(declarer, declarer, restored), [declarer]);
    let completed = led;
    for (let i = 0; i < 3; i++) completed = playCard(completed, legalCards(completed)[0], 'NT');
    assert.equal(completed.trick.length, 0);
    assert.deepEqual(new Set(visibleHandSeats(declarer, declarer, completed)), new Set([declarer, dummy]));
  }
});
