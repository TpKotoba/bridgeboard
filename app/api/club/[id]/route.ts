import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getEvent, mutateEvent } from '@/lib/store';
import { checkOrigin, errorResponse, readJson } from '@/lib/http';
import { DomainError } from '@/lib/events';
import { resultSchema } from '@/lib/model';
import { clubView } from '@/lib/club-view';
export const dynamic = 'force-dynamic';
const bodySchema = z.object({ requestId: z.string().uuid(), round: z.number().int().min(1), confirm: z.boolean(), reviewVersion: z.string().max(32000).optional(), result: resultSchema.optional() }).strict();
function hash(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  if (!/^[a-f0-9]{64}$/.test(token)) throw new DomainError('請使用裁判提供的專屬連結', 401);
  return createHash('sha256').update(token).digest('hex');
}
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tokenHash = hash(request);
    const { event } = await getEvent((await params).id);
    const pair = Object.entries(event.club?.tokens ?? {}).find(([, h]) => h === tokenHash)?.[0];
    if (!event.club?.enabled || !pair) throw new DomainError('連結已失效或俱樂部模式未開啟', 403);
    return NextResponse.json(clubView(event, pair), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const tokenHash = hash(request);
    const body = bodySchema.parse(await readJson(request));
    const id = (await params).id;
    // Re-read on revision conflicts. The domain rechecks token, round and lock atomically on each attempt.
    for (let attempt = 0; attempt < 5; attempt++) {
      const { event } = await getEvent(id);
      try {
        await mutateEvent(id, { ...body, action: 'club-play', tokenHash, revision: event.revision, reason: body.confirm ? '搭檔確認本圈' : '搭檔輸入／更正' });
        return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
      } catch (e) {
        if (!(e instanceof DomainError) || e.status !== 409 || attempt === 4) throw e;
      }
    }
    throw new DomainError('請重試', 409);
  } catch (e) { return errorResponse(e); }
}
