import 'server-only';
import { neon } from '@neondatabase/serverless';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyMutation, DomainError, seedEvents } from './events';
import { BridgeEvent, Mutation, StoredEvent } from './model';
import { project } from './scoring';
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
  const rows = await sql()`SELECT document FROM bridge_events ORDER BY created_at DESC LIMIT 50`;
  return rows.map((r) => r.document as StoredEvent);
}
export async function getEvent(id: string): Promise<StoredEvent> {
  if (storageMode() !== 'neon') {
    const e = (await listEvents()).find((x) => x.event.id === id);
    if (!e) throw new DomainError('找不到賽事', 404);
    return e;
  }
  const rows = await sql()`SELECT document FROM bridge_events WHERE id=${id}`;
  if (!rows.length) throw new DomainError('找不到賽事', 404);
  return rows[0].document as StoredEvent;
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
      data.splice(index, 1);
      await localSave(data);
    });
  const rows =
    await sql()`DELETE FROM bridge_events WHERE id=${id} AND revision=${revision} RETURNING id`;
  if (!rows.length) throw new DomainError('賽事已更新或刪除，請重新載入', 409);
}
export async function insertEvent(event: BridgeEvent) {
  if (storageMode() === 'demo') throw new DomainError('展示模式無法儲存，請先設定資料庫。', 503);
  const stored = { event, projection: project(event), requests: [] };
  if (storageMode() === 'local')
    return localLock(async () => {
      const data = await localRead();
      if (data.length >= 50) throw new DomainError('MVP 最多 50 場賽事');
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
  const previous = await getEvent(id),
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
