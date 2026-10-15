import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation, makeBoard } from '../lib/events';
import { contractScore, miniGameLevel, project } from '../lib/scoring';
import type { ResultInput } from '../lib/model';
import { clubView } from '../lib/club-view';
import { exportResultsCsv, parseResultsCsv, exportPbn } from '../lib/imports';

const input = (strain: ResultInput['strain'], level: number, tricks = level + 6): ResultInput => ({
  assignmentId: 'a', board: 1, strain, level, tricks, declarer: 'N', doubled: 1, lead: '', miniBridge: true,
});
test('all ten MiniBridge contracts: non-vulnerable scoring, overtricks, undertricks and direction', () => {
  for (const strain of ['C', 'D', 'H', 'S', 'NT'] as const) {
    const minor = strain === 'C' || strain === 'D';
    for (const level of [1, miniGameLevel(strain)]) {
      const base = level * (minor ? 20 : 30) + (strain === 'NT' ? 10 : 0);
      for (let tricks = 0; tricks <= 13; tricks++) {
        const delta = tricks - level - 6;
        const expected = delta < 0 ? delta * 50 : base + (level === 1 ? 50 : 300) + delta * (minor ? 20 : 30);
        for (const vulnerability of ['None', 'NS', 'EW', 'All'] as const) {
          assert.equal(contractScore(input(strain, level, tricks), vulnerability), expected);
          assert.equal(contractScore({ ...input(strain, level, tricks), declarer: 'E' }, vulnerability), -expected);
        }
      }
    }
  }
  assert.equal(contractScore(input('NT', 1, 13), 'All'), 270);
  assert.equal(contractScore(input('NT', 3, 9), 'All'), 400);
  assert.equal(contractScore(input('H', 4, 10), 'All'), 420);
  assert.equal(contractScore(input('C', 5, 11), 'All'), 400);
});
test('MiniBridge rejects ordinary levels, pass, doubles and slams', () => {
  for (const strain of ['C', 'D', 'H', 'S', 'NT'] as const) {
    for (let level = 0; level <= 7; level++) {
      if (level === 1 || level === miniGameLevel(strain)) continue;
      assert.throws(() => contractScore(input(strain, level), 'None'), /MiniBridge/);
    }
    for (const doubled of [2, 4] as const) assert.throws(() => contractScore({ ...input(strain, 1), doubled }, 'None'), /MiniBridge/);
  }
});
test('MiniBridge event persists mode, scores on server and supports cancellation and restoration', () => {
  const event = createEvent({ name: 'MiniBridge', kind: 'pairs', gameMode: 'minibridge', names: ['A','B','C','D'], rounds: 1, boardsPerRound: 4, date: '2026-10-16', venue: '' });
  assert.ok(event.boards.every(b => b.vulnerability === 'None'));
  assert.equal(clubView(event, 'p1').gameMode, 'minibridge');
  const result = { ...input('H', 4, 10), assignmentId: event.assignments[0].id, miniBridge: false };
  let stored = { event, projection: project(event), requests: [] as string[] };
  const meta = () => ({ revision: stored.event.revision, requestId: randomUUID(), reason: '測試 MiniBridge' });
  stored = applyMutation(stored, { ...meta(), action: 'results', results: [result] });
  const key = `${result.assignmentId}:1`;
  assert.equal(stored.event.results[key].nsScore, 420);
  assert.equal(stored.event.results[key].miniBridge, true);
  const imported = parseResultsCsv(exportResultsCsv(stored.event));
  assert.equal(imported[0].level, 4);
  assert.equal(imported[0].strain, 'H');
  assert.throws(() => applyMutation(stored, { ...meta(), action: 'results', results: [{ ...result, doubled: 2 }] }), /MiniBridge/);
  stored = applyMutation(stored, { ...meta(), action: 'ruling', assignmentId: result.assignmentId, board: 1, cancelled: true });
  assert.equal(stored.event.results[key].nsScore, 0);
  stored = applyMutation(stored, { ...meta(), action: 'ruling', assignmentId: result.assignmentId, board: 1, cancelled: false, result });
  assert.equal(stored.event.results[key].nsScore, 420);
});
test('MiniBridge PBN import removes vulnerability and table input uses the same rules', () => {
  const event = createEvent({ name: 'MiniBridge table', kind: 'pairs', gameMode: 'minibridge', names: ['A','B','C','D'], rounds: 1, boardsPerRound: 4, date: '2026-10-16', venue: '' });
  let stored = { event, projection: project(event), requests: [] as string[] };
  const meta = () => ({ revision: stored.event.revision, requestId: randomUUID(), reason: '測試桌上登分' });
  const withVulnerability = { ...event, boards: event.boards.map(b => ({ ...makeBoard(b.number), vulnerability: 'All' as const })) };
  stored = applyMutation(stored, { ...meta(), action: 'pbn', pbn: exportPbn(withVulnerability) });
  assert.ok(stored.event.boards.every(b => b.vulnerability === 'None'));
  stored = applyMutation(stored, { ...meta(), action: 'club-config', enabled: true });
  const a = stored.event.assignments[0];
  const tokenHash = 'a'.repeat(64);
  stored = applyMutation(stored, { ...meta(), action: 'club-config', enabled: true, participantId: a.ns, tokenHash });
  stored = applyMutation(stored, { ...meta(), action: 'round-control', round: 1, phase: 'playing' });
  const result = { ...input('NT', 1, 13), assignmentId: a.id, miniBridge: false };
  stored = applyMutation(stored, { ...meta(), action: 'club-play', tokenHash, round: 1, confirm: false, result });
  assert.equal(stored.event.results[`${a.id}:1`].nsScore, 270);
  assert.equal(clubView(stored.event, a.ns).boards[0].result?.miniBridge, true);
  assert.throws(() => applyMutation(stored, { ...meta(), action: 'club-play', tokenHash, round: 1, confirm: false, result: { ...result, level: 6 } }), /MiniBridge/);
});
