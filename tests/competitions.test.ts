import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent, applyMutation } from '../lib/events';
import { appendStage, competitionCatalog, inheritCompetition } from '../lib/competitions';
import { project } from '../lib/scoring';
import type { StoredEvent } from '../lib/model';

function setup(): StoredEvent {
  const event = createEvent({ name: '俱樂部盃', kind: 'pairs', pairMethod: 'mp', date: '2026-10-16', venue: '臺北', names: ['A', 'B', 'C', 'D'], rounds: 1, boardsPerRound: 2 });
  return { event, projection: project(event), requests: [] };
}
function child() {
  return createEvent({ name: '團體決賽', kind: 'teams', date: '2026-10-17', venue: '不應採用', names: ['甲', '乙', '丙', '丁'], rounds: 2, boardsPerRound: 4 });
}
test('new competitions can start with a named first stage', () => {
  const e = createEvent({ name: '新賽事', firstStageName: '上午場', kind: 'pairs', date: '2026-10-16', venue: '臺北', names: ['A', 'B', 'C', 'D'], rounds: 1, boardsPerRound: 2 });
  const catalog = competitionCatalog([{ event: e, projection: project(e), requests: [] }]);
  assert.equal(catalog[0].name, '新賽事');
  assert.equal(catalog[0].hasStages, true);
  assert.equal(catalog[0].stages[0].name, '上午場');
});
test('legacy event is a standalone competition and promoting it preserves all original scores', () => {
  let original = setup();
  const a = original.event.assignments[0];
  original = applyMutation(original, { action: 'results', revision: 1, requestId: 'result', reason: '測試成績', results: [{ assignmentId: a.id, board: a.boards[0], level: 3, strain: 'NT', doubled: 1, declarer: 'N', tricks: 9, lead: '' }] });
  const before = structuredClone(original);
  const standalone = competitionCatalog([original]);
  assert.equal(standalone.length, 1);
  assert.equal(standalone[0].hasStages, false);
  assert.equal(standalone[0].stages[0].id, original.event.id);
  const next = appendStage(original, child(), original.event.revision, '雙人預賽');
  assert.deepEqual(original, before);
  assert.deepEqual(next.root.event.results, original.event.results);
  assert.deepEqual(next.root.projection, original.projection);
  assert.equal(next.root.event.stageName, '雙人預賽');
  assert.equal(next.stage.event.kind, 'teams');
  assert.equal(next.stage.event.participants[0].name, '甲');
  assert.equal(next.stage.event.rounds, 2);
  assert.equal(Object.keys(next.stage.event.results).length, 0);
  assert.equal(next.stage.projection.received, 0);
  const catalog = competitionCatalog([next.root, next.stage]);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].stages.length, 2);
  assert.equal(catalog[0].hasStages, true);
});

test('stages inherit current shared information; shared edits do not modify their scores or revision', () => {
  const original = setup();
  const next = appendStage(original, child(), 1, '初賽');
  const updated = applyMutation(next.root, { action: 'competition-settings', revision: next.root.event.revision, requestId: 'shared', reason: '變更場地', name: '俱樂部盃更新', prefix: '第十屆', date: '2026-11-01', venue: '新場地' });
  const stage = inheritCompetition(next.stage, updated.event);
  assert.equal(stage.event.date, '2026-11-01');
  assert.equal(stage.event.venue, '新場地');
  assert.equal(stage.event.competition?.name, '俱樂部盃更新');
  assert.equal(stage.event.stageName, '團體決賽');
  assert.equal(stage.event.revision, next.stage.event.revision);
  assert.deepEqual(stage.event.results, next.stage.event.results);
  assert.throws(() => applyMutation(next.stage, { action: 'competition-settings', revision: 1, requestId: 'bad', reason: '修改日期', name: '錯誤名稱', prefix: '', date: '2026-11-02', venue: '其他場地' }), /主頁/);
});

test('stage creation rejects stale parent revisions and nested stages; stage names are independent', () => {
  const original = setup();
  assert.throws(() => appendStage(original, child(), 2, '初賽'), /更新/);
  assert.throws(() => appendStage(original, child(), 1), /第一賽段/);
  const next = appendStage(original, child(), 1, '初賽');
  assert.throws(() => appendStage(next.stage, child(), 1, '子賽段'), /子賽段/);
  const renamed = applyMutation(next.root, { action: 'settings', revision: 2, requestId: 'rename', reason: '修改賽段', status: 'live', stageName: '上午預賽' });
  assert.equal(renamed.event.name, original.event.name);
  assert.equal(renamed.event.stageName, '上午預賽');
  assert.throws(() => applyMutation(next.stage, { action: 'settings', revision: 1, requestId: 'rename-parent', reason: '修改賽事', status: 'live', name: '非法變更' }), /主頁/);
});
