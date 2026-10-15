import 'server-only';
import { neon } from '@neondatabase/serverless';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyMutation, DomainError, seedEvents } from './events';
import { BridgeEvent, Mutation, StoredEvent } from './model';
import { project } from './scoring';
import { appendStage, inheritCompetition } from './competitions';
import { deletionTargets, type CompetitionDeletion } from './competition-deletion';
export function storageMode() {
  const mode = process.env.STORAGE_MODE ?? (process.env.DATABASE_URL ? 'neon' : 'demo');
  if (mode === 'local' && process.env.VERCEL) throw new Error('Vercel 不支援 local 儲存模式');
  if (!['local', 'neon', 'demo'].includes(mode)) throw new Error('Invalid STORAGE_MODE');
  return mode;
}
const file = path.join(process.cwd(), '.data', 'events.json');
let queue = Promise.resolve();
async function localLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>((r) => {
    release = r;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}
async function localRead(): Promise<StoredEvent[]> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return seedEvents();
    throw e;
  }
}
async function localSave(data: StoredEvent[]) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file + '.tmp', JSON.stringify(data), 'utf8');
  await rename(file + '.tmp', file);
}
function sql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 尚未設定');
  return neon(process.env.DATABASE_URL);
}
export async function listEvents(): Promise<StoredEvent[]> {
  if (storageMode() === 'demo') return seedEvents();
  if (storageMode() === 'local') return localRead();
  const rows = await sql()`SELECT document FROM bridge_events ORDER BY updated_at DESC`;
  return rows.map((r) => r.document as StoredEvent);
}
async function getRawEvent(id: string): Promise<StoredEvent> {
  if (storageMode() !== 'neon') {
    const e = (await listEvents()).find((x) => x.event.id === id);
    if (!e) throw new DomainError('找不到賽事', 404);
    return e;
  }
  const rows = await sql()`SELECT document FROM bridge_events WHERE id=${id}`;
  if (!rows.length) throw new DomainError('找不到賽事', 404);
  return rows[0].document as StoredEvent;
}
export async function getEvent(id: string): Promise<StoredEvent> {
  const stored = await getRawEvent(id);
  const root = stored.event.parentEventId ? await getRawEvent(stored.event.parentEventId) : stored;
  return inheritCompetition(stored, root.event);
}
export async function deleteEvent(id: string, revision: number) {
  if (storageMode() === 'demo') throw new DomainError('展示模式無法刪除賽事。', 503);
  if (storageMode() === 'local')
    return localLock(async () => {
      const data = await localRead();
      const index = data.findIndex((item) => item.event.id === id);
      if (index < 0) throw new DomainError('找不到賽事', 404);
      if (data[index].event.revision !== revision)
        throw new DomainError('賽事已更新，請重新載入後再刪除', 409);
      if (data.some(s => s.event.parentEventId === id)) throw new DomainError('請先刪除其他賽段，再刪除此賽事');
      data.splice(index, 1);
      await localSave(data);
    });
  const rows =
    await sql()`DELETE FROM bridge_events WHERE id=${id} AND revision=${revision} AND NOT EXISTS (SELECT 1 FROM bridge_events child WHERE child.document->'event'->>'parentEventId'=${id}) RETURNING id`;
  if (!rows.length) throw new DomainError('賽事已更新或刪除，請重新載入', 409);
}
export async function deleteCompetitions(input: CompetitionDeletion) {
  if (storageMode() === 'demo') throw new DomainError('展示模式無法刪除賽事。', 503);
  if (storageMode() === 'local') return localLock(async () => {
    const data = await localRead();
    const targets = deletionTargets(data, input);
    const ids = new Set(targets.map(t => t.id));
    await localSave(data.filter(s => !ids.has(s.event.id)));
    return input.competitions.length;
  });
  const targets = deletionTargets(await listEvents(), input);
  const roots = input.competitions.map(c => c.id);
  // Lock the complete families and recheck every revision before a single atomic delete.
  const rows = await sql()`WITH expected AS (
    SELECT * FROM jsonb_to_recordset(${JSON.stringify(targets)}::jsonb) AS x(id text, revision integer)
  ), locked AS MATERIALIZED (
    SELECT id, revision FROM bridge_events
    WHERE id IN (SELECT id FROM expected)
      OR document->'event'->>'parentEventId' IN (SELECT jsonb_array_elements_text(${JSON.stringify(roots)}::jsonb))
    ORDER BY id FOR UPDATE
  ), valid AS (
    SELECT 1 WHERE (SELECT count(*) FROM locked) = (SELECT count(*) FROM expected)
      AND NOT EXISTS (SELECT 1 FROM expected e LEFT JOIN locked l ON l.id=e.id AND l.revision=e.revision WHERE l.id IS NULL)
  ) DELETE FROM bridge_events WHERE id IN (SELECT id FROM locked) AND EXISTS (SELECT 1 FROM valid) RETURNING id`;
  if (rows.length !== targets.length) throw new DomainError('賽事已更新，請重新載入清單後再刪除', 409);
  return input.competitions.length;
}
export async function insertEvent(event: BridgeEvent) {
  if (storageMode() === 'demo') throw new DomainError('展示模式無法儲存，請先設定資料庫。', 503);
  const stored = { event, projection: project(event), requests: [] };
  if (storageMode() === 'local')
    return localLock(async () => {
      const data = await localRead();
      if (data.filter(s => !s.event.parentEventId).length >= 50) throw new DomainError('最多 50 場賽事');
      data.push(stored);
      await localSave(data);
      return stored;
    });
  await sql()`INSERT INTO bridge_events (id,revision,document) VALUES (${event.id},${event.revision},${JSON.stringify(stored)}::jsonb)`;
  return stored;
}
export async function mutateEvent(id: string, command: Mutation): Promise<StoredEvent> {
  if (storageMode() === 'demo') throw new DomainError('展示模式無法儲存，請先設定資料庫。', 503);
  if (storageMode() === 'local')
    return localLock(async () => {
      const data = await localRead();
      const index = data.findIndex((x) => x.event.id === id);
      if (index < 0) throw new DomainError('找不到賽事', 404);
      data[index] = applyMutation(data[index], command);
      await localSave(data);
      return data[index];
    });
  const previous = await getRawEvent(id),
    next = applyMutation(previous, command);
  if (next === previous) return previous;
  // One conditional SQL statement atomically commits raw results, audit and derived snapshot.
  const rows =
    await sql()`UPDATE bridge_events SET document=${JSON.stringify(next)}::jsonb,revision=${next.event.revision},updated_at=now() WHERE id=${id} AND revision=${command.revision} RETURNING id`;
  if (!rows.length) {
    const current = await getEvent(id);
    if (current.requests.includes(command.requestId)) return current;
    throw new DomainError('另一個操作已更新成績，請重新載入。', 409);
  }
  return next;
}
export async function insertStage(parentId: string, stage: BridgeEvent, revision: number, firstStageName?: string) {
  if (storageMode() === 'demo') throw new DomainError('展示模式無法新增賽段', 503);
  if (storageMode() === 'local') return localLock(async () => {
    const data = await localRead();
    const index = data.findIndex(s => s.event.id === parentId);
    if (index < 0) throw new DomainError('找不到賽事', 404);
    if (data.filter(s => s.event.parentEventId === parentId).length >= 31) throw new DomainError('每場最多 32 個賽段');
    const next = appendStage(data[index], stage, revision, firstStageName);
    data[index] = next.root;
    data.push(next.stage);
    await localSave(data);
    return next.stage;
  });
  const parent = await getRawEvent(parentId);
  const next = appendStage(parent, stage, revision, firstStageName);
  const rows = await sql()`WITH updated AS (
    UPDATE bridge_events SET document=${JSON.stringify(next.root)}::jsonb, revision=${next.root.event.revision}, updated_at=now()
    WHERE id=${parentId} AND revision=${revision}
      AND (SELECT count(*) FROM bridge_events child WHERE child.document->'event'->>'parentEventId'=${parentId}) < 31
    RETURNING id
  ) INSERT INTO bridge_events (id, revision, document)
    SELECT ${stage.id}, ${stage.revision}, ${JSON.stringify(next.stage)}::jsonb FROM updated RETURNING id`;
  if (!rows.length) throw new DomainError('賽事已更新，請重新載入', 409);
  return next.stage;
}
