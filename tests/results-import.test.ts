import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import { exportResultsCsv, parseResultsCsv } from '../lib/imports';
import { mutationSchema } from '../lib/model';
import { project } from '../lib/scoring';
const header = 'assignmentId,board,level,strain,doubled,declarer,tricks,lead,status\n';
for (const kind of ['pairs', 'teams'] as const) test(`${kind}: mixed cancelled CSV imports are atomic, audited and round-trip`, () => {
  const event = createEvent({ name: '取消牌匯入', kind, names: ['A','B','C','D'], date: '2026-10-16', venue: '', rounds: 2, boardsPerRound: 2 });
  const id = event.assignments[0].id;
  const command = (csv: string, revision = 1) => mutationSchema.parse({ action: 'results-import', revision, requestId: randomUUID(), reason: '匯入成績測試', csv });
  const stored = { event, projection: project(event), requests: [] };
  const csv = header + `${id},1,4,S,1,N,10,,played\n${id},2,,,,,,,Cancelled`;
  const imported = applyMutation(stored, command(csv));
  assert.equal(imported.event.results[`${id}:2`].status, 'cancelled');
  assert.equal(imported.event.results[`${id}:2`].nsScore, 0);
  assert.equal(imported.projection.received, 2);
  assert.equal(imported.event.audit.at(-1)?.changes?.length, 2);
  if (kind === 'pairs') assert.equal(imported.projection.pairScores[`${id}:2`].ns, null);
  const copy = applyMutation(stored, command(exportResultsCsv(imported.event)));
  assert.equal(copy.event.results[`${id}:2`].status, 'cancelled');
  const restored = applyMutation(imported, command(header + `${id},2,3,NT,1,N,9,,played`, 2));
  assert.equal(restored.event.results[`${id}:2`].status ?? 'played', 'played');
  assert.equal(restored.event.results[`${id}:2`].nsScore, 600);
  for (const bad of [csv + `\n${id},2,,,,,,,cancelled`, csv + '\nmissing,1,,,,,,,cancelled', header + `${id},1,,,,,,,unknown`]) {
    assert.throws(() => applyMutation(stored, command(bad)));
    assert.deepEqual(stored.event.results, {});
  }
  assert.throws(() => mutationSchema.parse({ action: 'results', revision: 1, requestId: randomUUID(), reason: '不得繞過', results: parseResultsCsv(csv) }));
  assert.throws(() => applyMutation({ ...stored, event: { ...event, status: 'finished' } }, command(csv)), /重新開放/);
  for (const status of ['average', 'Average', ' AVERAGE ']) {
    const legacy = applyMutation(stored, command(header + `${id},1,,,,,,,${status}`));
    assert.equal(legacy.event.results[`${id}:1`].status, 'cancelled');
    assert.equal(legacy.event.results[`${id}:1`].nsScore, 0);
    assert.equal(legacy.event.audit.at(-1)?.changes?.[0].after?.status, 'cancelled');
    assert.ok(!exportResultsCsv(legacy.event).includes('average'));
    if (kind === 'pairs') assert.equal(legacy.projection.pairScores[`${id}:1`].ns, null);
  }
  const legacyResult = { ...imported.event.results[`${id}:1`], status: 'average' as const };
  const exported = exportResultsCsv({ ...event, results: { [`${id}:1`]: legacyResult } });
  assert.ok(exported.includes('cancelled'));
  assert.ok(!exported.includes('average'));
  assert.equal(parseResultsCsv(exported)[0].status, 'cancelled');
});

