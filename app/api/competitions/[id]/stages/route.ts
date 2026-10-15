import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSchema } from '@/lib/model';
import { createEvent, DomainError } from '@/lib/events';
import { insertStage } from '@/lib/store';
import { errorResponse, requireAdmin, readJson } from '@/lib/http';
import { isDirector } from '@/lib/auth';
export const dynamic = 'force-dynamic';
const schema = z.object({ stage: createSchema, revision: z.number().int(), firstStageName: z.string().trim().min(1).max(80).optional() }).strict();
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    if (!(await isDirector())) throw new DomainError('新增賽段僅限裁判', 403);
    const body = schema.parse(await readJson(request));
    const stage = createEvent(body.stage);
    delete stage.hasStages;
    const stored = await insertStage((await params).id, stage, body.revision, body.firstStageName);
    return NextResponse.json({ id: stored.event.id }, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
