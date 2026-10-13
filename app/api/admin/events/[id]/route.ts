import { NextResponse } from 'next/server';
import { isAdmin, isDirector } from '@/lib/auth';
import { deleteEvent, getEvent } from '@/lib/store';
import { DomainError } from '@/lib/events';
import { checkOrigin, errorResponse, readJson } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await isAdmin())) throw new DomainError('請先登入', 401);
    const stored = await getEvent((await params).id);
    return NextResponse.json(
      { ...stored.event, projection: stored.projection, canDirect: await isDirector() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    if (!(await isDirector())) throw new DomainError('此操作僅限裁判', 403);
    const id = (await params).id;
    const body = await readJson(request);
    const stored = await getEvent(id);
    if (body?.confirmName !== stored.event.name)
      throw new DomainError('請輸入完整賽事名稱以確認刪除');
    await deleteEvent(id);
    return NextResponse.json({ deleted: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}
