import { audienceEvent } from '@/lib/club-view';
import { NextResponse } from 'next/server';
import { getEvent, mutateEvent } from '@/lib/store';
import { mutationSchema } from '@/lib/model';
import { errorResponse, readJson, requireAdmin } from '@/lib/http';
import { isDirector } from '@/lib/auth';
import { DomainError } from '@/lib/events';
export const dynamic = 'force-dynamic';
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { event } = await getEvent((await params).id);
    return NextResponse.json(
      audienceEvent(event),
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
    if (command.action.startsWith('club-')) throw new DomainError('請使用俱樂部模式入口', 403);
    if (
      command.action === 'settings' &&
      (command.name !== undefined || command.prefix !== undefined) &&
      !(await isDirector())
    )
      throw new DomainError('修改賽事名稱與前綴僅限裁判', 403);
    if (
      ['pbn', 'movement', 'board-publication', 'round-control', 'round-timing'].includes(
        command.action,
      ) &&
      !(await isDirector())
    )
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
