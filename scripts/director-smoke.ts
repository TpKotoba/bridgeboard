import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const origin = 'http://127.0.0.1:3000';
let cookie = '';
async function call(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(origin + path, {
    method,
    headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function login(password: string) {
  const r = await call('/api/session', 'POST', { password });
  assert.equal(r.status, 200);
  cookie = r.headers.get('set-cookie')!.split(';')[0];
}
async function main() {
  assert.equal((await call('/api/session')).body.storage, 'local');
  await login(process.env.DIRECTOR_PASSWORD ?? 'local-bridge-director-2026');
  const name = `裁判驗收 ${randomUUID()}`;
  const created = await call('/api/events', 'POST', {
    name,
    prefix: 'QA 前綴',
    kind: 'pairs',
    pairMethod: 'butler',
    date: '2026-10-14',
    venue: 'QA',
    names: ['QA A', 'QA B', 'QA C', 'QA D'],
    rounds: 3,
    boardsPerRound: 2,
  });
  assert.equal(created.status, 201);
  const id = created.body.id;
  try {
    await login(process.env.ADMIN_PASSWORD ?? 'local-bridge-admin-2026');
    assert.equal((await call('/api/events', 'POST', {})).status, 403);
    const staff = await call(`/api/admin/events/${id}`);
    assert.equal(staff.body.canDirect, false);
    assert.ok(!('audit' in staff.body));
    assert.equal(staff.body.prefix, 'QA 前綴');
    let staffRevision = 1;
    const patch = async (payload: object, status = 200) => {
      const response = await call(`/api/events/${id}`, 'PATCH', {
        ...payload,
        revision: staffRevision,
        requestId: randomUUID(),
        reason: '賽務權限驗收',
      });
      assert.equal(response.status, status, JSON.stringify(response.body));
      if (status === 200) staffRevision = response.body.revision;
    };
    await patch({ action: 'pbn', pbn: 'forbidden' }, 403);
    await patch({ action: 'movement', csv: 'forbidden' }, 403);
    await patch({ action: 'board-publication', board: 1, published: true }, 403);
    await patch({ action: 'settings', status: 'live', prefix: 'forbidden' }, 403);
    const a = staff.body.assignments[0];
    await patch({ action: 'ruling', assignmentId: a.id, board: a.boards[0], cancelled: true });
    await patch({ action: 'penalty', participantId: 'p1', amount: 2 });
    assert.equal(
      (await call(`/api/admin/events/${id}`, 'DELETE', { confirmName: name, revision: 1 })).status,
      403,
    );
    await login(process.env.DIRECTOR_PASSWORD ?? 'local-bridge-director-2026');
    assert.ok('audit' in (await call(`/api/admin/events/${id}`)).body);
    assert.equal(
      (await call(`/api/admin/events/${id}`, 'DELETE', { confirmName: 'wrong', revision: 1 }))
        .status,
      400,
    );
    const updated = await call(`/api/events/${id}`, 'PATCH', {
      action: 'settings',
      status: 'live',
      awardPlaces: 4,
      prefix: '更新前綴',
      revision: staffRevision,
      requestId: randomUUID(),
      reason: '驗收給獎設定',
    });
    assert.equal(updated.status, 200);
    assert.equal((await call(`/api/events/${id}`)).body.awardPlaces, 4);
    assert.equal((await call(`/api/events/${id}`)).body.prefix, '更新前綴');
    assert.equal((await call('/api/events')).body.events.find((e: {id: string}) => e.id === id).prefix, '更新前綴');
    assert.equal(
      (await call(`/api/admin/events/${id}`, 'DELETE', { confirmName: name, revision: 1 })).status,
      409,
    );
    assert.equal((await call(`/api/events/${id}`)).status, 200);
    const deleted = await call(`/api/admin/events/${id}`, 'DELETE', {
      confirmName: name,
      revision: updated.body.revision,
    });
    assert.equal(deleted.status, 200);
    assert.equal((await call(`/api/events/${id}`)).status, 404);
    const list = await call('/api/events');
    assert.ok(!list.body.events.some((event: { id: string }) => event.id === id));
    const doc = await fetch(origin + '/docs/import-formats.md');
    assert.equal(doc.status, 200);
    assert.match(await doc.text(), /BridgeboardGroup/);
    console.log(
      'Director API: awards, role protection, name confirmation, stale deletion, deletion and documentation passed. Temporary event removed.',
    );
  } finally {
    await login(process.env.DIRECTOR_PASSWORD ?? 'local-bridge-director-2026');
    const remaining = await call(`/api/admin/events/${id}`);
    if (remaining.status === 200) {
      const removed = await call(`/api/admin/events/${id}`, 'DELETE', {
        confirmName: name,
        revision: remaining.body.revision,
      });
      assert.equal(removed.status, 200, 'Temporary event cleanup failed');
    }
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
