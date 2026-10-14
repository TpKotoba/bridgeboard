import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isDirector } from '@/lib/auth';
import { getEvent, mutateEvent } from '@/lib/store';
import { requireAdmin, errorResponse, readJson } from '@/lib/http';
import { DomainError } from '@/lib/events';
export const dynamic = 'force-dynamic';
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('enable'), enabled: z.boolean(), revision: z.number().int() }).strict(),
  z.object({ action: z.literal('issue'), pair: z.string().min(1), revision: z.number().int() }).strict(),
  z.object({ action: z.literal('finalize'), round: z.number().int().min(1), force: z.boolean(), reason: z.string().trim().min(2).max(200), revision: z.number().int() }).strict(),
]);
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    if (!(await isDirector())) throw new DomainError('僅限裁判操作', 403);
    const input = schema.parse(await readJson(request));
    const id = (await params).id;
    const { event } = await getEvent(id);
    const meta = { revision: input.revision, requestId: randomUUID(), reason: '設定俱樂部模式' };
    let token: string | undefined;
    if (input.action === 'finalize') {
      await mutateEvent(id, { ...meta, action: 'club-finalize', round: input.round, force: input.force, reason: input.reason });
    } else {
      token = input.action === 'issue' ? randomBytes(32).toString('hex') : undefined;
      await mutateEvent(id, { ...meta, action: 'club-config', enabled: input.action === 'enable' ? input.enabled : !!event.club?.enabled,
        ...(input.action === 'issue' ? { participantId: input.pair, tokenHash: createHash('sha256').update(token!).digest('hex') } : {}),
      });
    }
    return NextResponse.json({ ok: true, ...(token ? { path: `/club?event=${encodeURIComponent(id)}#${token}` } : {}) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
