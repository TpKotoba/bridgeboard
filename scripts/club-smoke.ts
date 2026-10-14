import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const origin = 'http://127.0.0.1:3000';
let cookie = '';
async function call(path: string, method = 'GET', body?: unknown, token?: string) {
  const r = await fetch(origin + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : { Cookie: cookie }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json(), headers: r.headers };
}
async function login(password: string) {
  const r = await call('/api/session', 'POST', { password });
  assert.equal(r.status, 200); cookie = r.headers.get('set-cookie')!.split(';')[0];
}
async function main() {
  assert.equal((await call('/api/session')).body.storage, 'local');
  await login(process.env.DIRECTOR_PASSWORD ?? 'local-bridge-director-2026');
  const name = 'Club smoke ' + randomUUID();
  const created = await call('/api/events', 'POST', { name, kind: 'pairs', pairMethod: 'crossimp', trim: 'none', date: '2026-10-14', venue: '', names: ['QA A', 'QA B', 'QA C', 'QA D'], rounds: 1, boardsPerRound: 2 });
  assert.equal(created.status, 201); const id = created.body.id;
  const admin = async () => (await call(`/api/admin/events/${id}`)).body;
  const command = async (body: object) => call(`/api/admin/club/${id}`, 'POST', { ...body, revision: (await admin()).revision });
  try {
    assert.equal((await command({ action: 'enable', enabled: true })).status, 200);
    const e = await admin(), a = e.assignments[0];
    const tokens: Record<string, string> = {};
    for (const p of e.participants) {
      const issued = await command({ action: 'issue', pair: p.id });
      assert.equal(issued.status, 200); tokens[p.id] = issued.body.path.split('#')[1];
    }
    assert.equal((await call(`/api/club/${id}`)).status, 401);
    assert.equal((await call(`/api/events/${id}`, 'PATCH', { action: 'round-control', round: 1, phase: 'playing', revision: (await admin()).revision, requestId: randomUUID(), reason: 'QA 開始' })).status, 200);
    const payload = (board: number, tricks = 9) => ({ assignmentId: a.id, board, level: 3, strain: 'NT', doubled: 1, declarer: 'N', tricks, lead: '' });
    const submit = (pair: string, body: object) => call(`/api/club/${id}`, 'POST', { requestId: randomUUID(), round: 1, ...body }, tokens[pair]);
    assert.equal((await submit(a.ns, { confirm: true })).status, 400);
    const other = e.assignments.find((x: any) => x.id !== a.id);
    assert.equal((await submit(other.ns, { confirm: false, result: payload(1) })).status, 403);
    // Two shared-token devices may both submit; persistence must retry optimistic conflicts.
    const simultaneous = await Promise.all(a.boards.map((b: number) => submit(a.ns, { confirm: false, result: payload(b) })));
    simultaneous.forEach(r => assert.equal(r.status, 200));
    assert.equal((await submit(a.ns, { confirm: true })).status, 200);
    assert.equal((await submit(a.ns, { confirm: false, result: payload(1, 10) })).status, 403);
    assert.equal((await submit(a.ew, { confirm: false, result: payload(1, 10) })).status, 200);
    const own = await call(`/api/club/${id}`, 'GET', undefined, tokens[a.ns]);
    assert.equal(own.body.locked, true); assert.equal(own.body.boards[0].result.tricks, 10);
    assert.ok(!JSON.stringify(own.body).includes('token')); assert.ok(!JSON.stringify(own.body).includes('"deal"'));
    const audience = await call(`/api/events/${id}`);
    assert.equal(Object.keys(audience.body.results).length, 0); assert.ok(!('club' in audience.body));
    assert.equal((await command({ action: 'finalize', round: 1, force: false, reason: 'QA 正常結算' })).status, 400);
    await login(process.env.ADMIN_PASSWORD ?? 'local-bridge-admin-2026');
    assert.equal((await call(`/api/admin/club/${id}`, 'POST', { action: 'enable', enabled: false, revision: 1 })).status, 403);
    await login(process.env.DIRECTOR_PASSWORD ?? 'local-bridge-director-2026');
    assert.equal((await command({ action: 'finalize', round: 1, force: true, reason: 'QA 強制結算' })).status, 200);
    assert.ok(Object.keys((await call(`/api/events/${id}`)).body.results).length > 0);
    assert.equal((await submit(a.ew, { confirm: false, result: payload(1) })).status, 409);
    const replacement = await command({ action: 'issue', pair: a.ew }); assert.equal(replacement.status, 200);
    assert.equal((await call(`/api/club/${id}`, 'GET', undefined, tokens[a.ew])).status, 403);
    assert.equal((await fetch(origin + '/club?event=' + id)).status, 200);
    console.log('Club API smoke passed: token scope, concurrency, lock, publication, permissions, rotation, page.');
  } finally {
    await login(process.env.DIRECTOR_PASSWORD ?? 'local-bridge-director-2026');
    const e = await admin();
    const deleted = await call(`/api/admin/events/${id}`, 'DELETE', { revision: e.revision, confirmName: name });
    assert.equal(deleted.status, 200);
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
