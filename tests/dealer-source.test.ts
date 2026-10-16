import test from 'node:test';
import assert from 'node:assert/strict';
import { compileDealerSource, generateDealerBoards } from '../lib/dealer-source';
import { makeBoard } from '../lib/events';
import { parsePbn, exportPbn } from '../lib/imports';

const deal = { N: ['SA','SK','SQ','SJ','HA','HK','HQ','DA','DK','DQ','CA','CK','CQ'], E: [], S: [], W: [] };
test('Dealer expressions support variables, precedence, shapes, suit counts and honours', () => {
  const source = `# comment
    strong = hcp(north) == 37
    condition strong and shape(north, any 4333 + 54xx - any 0xxx)
      && spades(north) == 4 && hearts(north) == 3 && hcp(north,clubs) == 9
      && hascard(north,AS) && controls(north) == 12 && losers(north) == 0
      && (1+2*3 == 7) && (10/3 == 3) && (10%3 == 1) && (1 ? 5 : 0) == 5
    action printpbn`;
  assert.equal(compileDealerSource(source, 1).accepts(deal), true);
  assert.equal(compileDealerSource('condition shape(north, 3433)', 1).accepts(deal), false);
  assert.equal(compileDealerSource('condition shape(north, any 4333 - 4xxx)', 1).accepts(deal), false);
  assert.equal(compileDealerSource('condition not (hcp(north) < 20) or 1 / 0', 1).accepts(deal), true);
});

test('generate honours predeal and constraints, supports metadata, round trips PBN', async () => {
  const boards = await generateDealerBoards([makeBoard(1), makeBoard(2)], `
    generate 1000 produce 2
    dealer west vulnerable ew
    predeal north SAKQJ, HAKQ, DAKQ, CAKQ
    condition hcp(north) == 37 and shape(north, 4333)
    action printall
  `);
  for (const board of boards) {
    assert.equal(board.dealer, 'W'); assert.equal(board.vulnerability, 'EW');
    assert.equal(board.deal.N.length, 13);
    assert.equal(new Set(Object.values(board.deal).flat()).size, 52);
    assert.equal(compileDealerSource('hcp(north) == 37', 1).accepts(board.deal), true);
  }
  assert.equal(parsePbn(exportPbn({ boards })).length, 2);
});

test('invalid, unsupported and impossible source fails explicitly; work can be cancelled', async () => {
  for (const source of ['condition tricks(north,spades)>8', 'action average hcp(north)', 'condition unknown > 5', 'predeal north SA predeal south SA', 'produce 129', 'generate 1000001', 'condition globalThis.fetch("x")']) {
    assert.throws(() => compileDealerSource(source, 1), source);
  }
  await assert.rejects(generateDealerBoards([makeBoard(1)], 'generate 5 condition hcp(north) > 40'), /上限/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(generateDealerBoards([makeBoard(1)], '', controller.signal), /取消/);
  assert.throws(() => compileDealerSource('a = b b = a condition a', 1).accepts(deal), /循環/);
});
