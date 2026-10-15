import test from 'node:test';
import assert from 'node:assert/strict';
import { displayedBoardNumber } from '../lib/board-navigation';
import { createEvent, applyMutation } from '../lib/events';
import { project } from '../lib/scoring';
import { mutationSchema } from '../lib/model';
import { randomUUID } from 'node:crypto';

test('pairs default to unlimited board numbering; explicit limits and teams still wrap', () => {
  const event = createEvent({ name: 'test', kind: 'pairs', names: ['A','B','C','D'], rounds: 2, boardsPerRound: 1, date: '2026-10-16', venue: '' });
  assert.equal(event.maxBoardNumber, 0);
  assert.equal(displayedBoardNumber(65, event), 65);
  assert.equal(displayedBoardNumber(65, {kind:'pairs'}), 65);
  assert.equal(displayedBoardNumber(65, {kind:'pairs', maxBoardNumber:32}), 1);
  assert.equal(displayedBoardNumber(65, {kind:'teams'}), 1);
  assert.equal(displayedBoardNumber(65, {kind:'teams', maxBoardNumber:0}), 65);
  const updated = applyMutation({event, projection:project(event), requests:[]}, mutationSchema.parse({action:'settings', status:'live', maxBoardNumber:0, revision:event.revision, requestId:randomUUID(), reason:'取消牌號上限'}));
  assert.equal(updated.event.maxBoardNumber, 0);
  assert.deepEqual(updated.event.boards, event.boards);
});
