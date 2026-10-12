import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { makeBoard } from '../lib/events';
import { exportPbn } from '../lib/imports';
const origin = 'http://127.0.0.1:3000';
let cookie = '';
async function call(path: string, method = 'GET', body?: unknown) {
  const r = await fetch(origin + path, { method, headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json(), headers: r.headers };
}
async function login(password: string) {
  const r = await call('/api/session', 'POST', { password });
  assert.equal(r.status, 200); cookie = r.headers.get('set-cookie')!.split(';')[0];
}
async function main() {
assert.equal((await call('/api/session')).body.storage, 'local');
await login(process.env.ADMIN_PASSWORD ?? 'local-bridge-admin-2026');
for (const pairMethod of ['crossimp', 'butler']) {
  const created = await call('/api/events', 'POST', { name: `進階驗收 ${pairMethod} ${Date.now()}`, kind: 'pairs', pairMethod, trim: 'one', date: '2026-10-13', venue: 'Local QA', names: ['QA A', 'QA B', 'QA C', 'QA D', 'QA E', 'QA F'], rounds: 1, boardsPerRound: 2 });
  assert.equal(created.status, 201);
  const id = created.body.id;
  let revision = 1;
  const patch = async (data: object, expected = 200) => {
    const r = await call(`/api/events/${id}`, 'PATCH', { ...data, revision, requestId: randomUUID(), reason: '進階驗收裁定' });
    assert.equal(r.status, expected, JSON.stringify(r.body));
    if (r.status === 200) revision = r.body.revision;
  };
  await patch({ action: 'pbn', pbn: exportPbn({ boards: [makeBoard(1), makeBoard(2)] }) });
  await patch({ action: 'board-publication', board: 1, published: true });
  const publicData = (await call(`/api/events/${id}`)).body;
  assert.equal(publicData.pairMethod, pairMethod); assert.equal(publicData.trim, 'one');
  assert.ok('deal' in publicData.boards[0]); assert.ok(!('deal' in publicData.boards[1]));
  const assignments = publicData.assignments;
  const results = assignments.flatMap((a: { id: string; boards: number[] }, i: number) => a.boards.map((board) => ({ assignmentId: a.id, board, level: 3, strain: 'NT', doubled: 1, declarer: 'N', tricks: 9 + i, lead: makeBoard(board).deal.E[0] })));
  await patch({ action: 'results', results });
  await patch({ action: 'penalty', participantId: 'p1', amount: 2 }, 403);
  await patch({ action: 'ruling', assignmentId: assignments[0].id, board: 1, cancelled: true }, 403);
  await login(process.env.DIRECTOR_PASSWORD ?? 'local-bridge-director-2026');
  assert.equal((await call('/api/session')).body.director, true);
  await patch({ action: 'ruling', assignmentId: assignments[0].id, board: 1, cancelled: true });
  let doc = (await call(`/api/events/${id}`)).body;
  assert.equal(doc.projection.received, 6);
  assert.equal(doc.projection.pairScores[`${assignments[0].id}:1`].cancelled, true);
  await patch({ action: 'results', results: [results[0]] }, 403);
  await patch({ action: 'penalty', participantId: 'p1', amount: 2 });
  doc = (await call(`/api/events/${id}`)).body;
  assert.equal(doc.projection.standings.find((s: { id: string }) => s.id === 'p1').penalty, 2);
  await patch({ action: 'ruling', assignmentId: assignments[0].id, board: 1, cancelled: false, result: results[0] });
  await patch({ action: 'board-publication', board: 1, published: false });
  doc = (await call(`/api/events/${id}`)).body;
  assert.ok(!('deal' in doc.boards[0]));
  await patch({ action: 'board-publication', board: 1, published: true });
  const admin = (await call(`/api/admin/events/${id}`)).body;
  assert.ok(admin.audit.some((a: { action: string }) => a.action === '裁判 Penalty'));
  console.log(`${pairMethod}: scoring, independent publication, director-only API, cancellation/restoration, penalty and audit passed. Event ${id}`);
  await login(process.env.ADMIN_PASSWORD ?? 'local-bridge-admin-2026');
}
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
