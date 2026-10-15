import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent } from '../lib/events';
import { project } from '../lib/scoring';
import { competitionCatalog } from '../lib/competitions';
import { deletionSchema, deletionTargets } from '../lib/competition-deletion';

function fixture() {
  const root = createEvent({ name: '比賽甲', kind: 'pairs', names: ['A', 'B', 'C', 'D'], date: '2026-10-16', venue: '', rounds: 1, boardsPerRound: 2 });
  const stage = { ...structuredClone(root), id: 'child-stage', parentEventId: root.id, name: '決賽', revision: 3 };
  const other = { ...structuredClone(root), id: 'other', name: '比賽乙' };
  const data = [root, stage, other].map(event => ({ event, projection: project(event), requests: [] }));
  const input = { competitions: competitionCatalog(data).map(c => ({ id: c.id, confirmName: c.name, stages: c.stages.map(s => ({ id: s.id, revision: s.revision })) })) };
  return { data, input, root, stage, other };
}
test('batch deletion includes all stages of selected competitions only', () => {
  const { data, input, root, stage, other } = fixture();
  const selected = { competitions: input.competitions.filter(c => c.id === root.id) };
  assert.deepEqual(deletionTargets(data, selected).map(t => t.id).sort(), [root.id, stage.id].sort());
  assert.equal(data.find(s => s.event.id === other.id)?.event.name, '比賽乙');
  assert.equal(deletionTargets(data, input).length, 3);
});
test('batch deletion rejects stale roots, changed or new stages and missing competitions without mutating data', () => {
  for (const change of ['root', 'child', 'new', 'missing']) {
    const { data, input } = fixture();
    if (change === 'root') data[0].event.revision++;
    if (change === 'child') data[1].event.revision++;
    if (change === 'new') data.push({ ...structuredClone(data[1]), event: { ...data[1].event, id: 'new-child' } });
    if (change === 'missing') data.pop();
    const before = structuredClone(data);
    assert.throws(() => deletionTargets(data, input), /更新|變更/);
    assert.deepEqual(data, before);
  }
});
test('batch deletion rejects empty, duplicate and stage-only selections', () => {
  const { data, input, stage } = fixture();
  assert.equal(deletionSchema.safeParse({ competitions: [] }).success, false);
  assert.throws(() => deletionTargets(data, { competitions: [input.competitions[0], input.competitions[0]] }), /重複/);
  assert.throws(() => deletionTargets(data, { competitions: [{ id: stage.id, confirmName: stage.name, stages: [{ id: stage.id, revision: stage.revision }] }] }), /變更/);
});

test('batch deletion requires an exact name for every selected competition', () => {
  const { data, input } = fixture();
  const before = structuredClone(data);
  for (const value of ['', 'wrong', input.competitions[0].confirmName + ' ']) {
    const changed = structuredClone(input);
    changed.competitions[0].confirmName = value;
    assert.throws(() => deletionTargets(data, changed), /名稱/);
  }
  assert.equal(deletionSchema.safeParse({ competitions: [{ id: 'test', stages: [{id:'test', revision:1}] }] }).success, false);
  assert.deepEqual(data, before);
});
