import { NextResponse } from 'next/server';
import { getEvent, mutateEvent } from '@/lib/store';
import { mutationSchema } from '@/lib/model';
import { errorResponse, readJson, requireAdmin } from '@/lib/http';
import { isDirector } from '@/lib/auth';
import { DomainError } from '@/lib/events';
import { publicBoards } from '@/lib/public-event';
export const dynamic = 'force-dynamic';
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { event, projection } = await getEvent((await params).id);
    const { audit, ...publicData } = event;
    void audit;
    const boards = publicBoards(event);
    return NextResponse.json(
      { ...publicData, boards, projection },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    const command = mutationSchema.parse(await readJson(request));
    if ((command.action === 'ruling' || command.action === 'penalty') && !(await isDirector()))
      throw new DomainError('此操作僅限裁判', 403);
    const stored = await mutateEvent((await params).id, command);
    return NextResponse.json(
      { revision: stored.event.revision },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
