import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const origin = 'http://127.0.0.1:3000';
let cookie = '';
async function call(path: string, method = 'GET', body?: unknown) {
  const r = await fetch(origin + path, { method, headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json(), headers: r.headers };
}
async function login(password: string) {
  const r = await call('/api/session', 'POST', { password });
  assert.equal(r.status, 200); cookie = r.headers.get('set-cookie')!.split(';')[0];
}
async function main() {
  assert.equal((await call('/api/session')).body.storage, 'local');
  await login(process.env.DIRECTOR_PASSWORD ?? 'local-bridge-director-2026');
  const name = 'Hierarchy QA ' + randomUUID();
  const input = { name, kind: 'pairs', pairMethod: 'mp', date: '2026-10-16', venue: 'QA 場地', names: ['QA A', 'QA B', 'QA C', 'QA D'], rounds: 1, boardsPerRound: 2 };
  const created = await call('/api/events', 'POST', input);
  assert.equal(created.status, 201);
  const id = created.body.id;
  let childId = '';
  const admin = async (key = id) => (await call(`/api/admin/events/${key}`)).body;
  try {
    const initial = await admin();
    assert.equal((await call('/api/competitions')).body.competitions.find((c: any) => c.id === id).hasStages, false);
    const stage = { ...input, name: '隊制決賽', kind: 'teams', names: ['QA 甲', 'QA 乙', 'QA 丙', 'QA 丁'], rounds: 2, boardsPerRound: 4, venue: '應忽略此場地' };
    await login(process.env.ADMIN_PASSWORD ?? 'local-bridge-admin-2026');
    assert.equal((await call(`/api/competitions/${id}/stages`, 'POST', { revision: initial.revision, firstStageName: '預賽', stage })).status, 403);
    await login(process.env.DIRECTOR_PASSWORD ?? 'local-bridge-director-2026');
    const add = await call(`/api/competitions/${id}/stages`, 'POST', { revision: initial.revision, firstStageName: '預賽', stage });
    assert.equal(add.status, 201); childId = add.body.id;
    assert.equal((await call(`/api/competitions/${id}/stages`, 'POST', { revision: initial.revision, firstStageName: '預賽', stage })).status, 409);
    const listing = (await call('/api/competitions')).body.competitions;
    assert.equal(listing.some((c: any) => c.id === childId), false);
    const competition = listing.find((c: any) => c.id === id);
    assert.equal(competition.stages.length, 2);
    assert.equal(competition.stages[0].name, '預賽');
    assert.equal(competition.stages[1].kind, 'teams');
    const before = await admin(childId);
    const meta = { action: 'competition-settings', revision: competition.revision, requestId: randomUUID(), reason: 'QA 共用資訊', name, prefix: 'QA', date: '2026-11-01', venue: 'QA 新地點' };
    assert.equal((await call(`/api/events/${id}`, 'PATCH', meta)).status, 200);
    assert.equal((await call(`/api/events/${id}`, 'PATCH', { ...meta, requestId: randomUUID() })).status, 409);
    const updated = (await call(`/api/events/${childId}`)).body;
    assert.equal(updated.date, '2026-11-01'); assert.equal(updated.venue, 'QA 新地點');
    assert.deepEqual(updated.results, before.results); assert.equal(updated.revision, before.revision);
    assert.equal(updated.competition.id, id);
    assert.equal((await call(`/api/events/${childId}`, 'PATCH', { ...meta, revision: before.revision, requestId: randomUUID() })).status, 400);
    assert.equal((await call(`/api/admin/events/${id}`, 'DELETE', { revision: (await admin()).revision, confirmName: name })).status, 400);
    for (const path of ['/', `/?competition=${id}`, `/?event=${childId}&view=standings`]) assert.equal((await fetch(origin + path)).status, 200);
    console.log('Competition API smoke passed: hierarchy, independent formats, shared metadata, permissions, conflicts, deletion protection and routes.');
  } finally {
    if (childId) { const e = await admin(childId); assert.equal((await call(`/api/admin/events/${childId}`, 'DELETE', { revision: e.revision, confirmName: e.name })).status, 200); }
    const e = await admin();
    assert.equal((await call(`/api/admin/events/${id}`, 'DELETE', { revision: e.revision, confirmName: e.name })).status, 200);
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
