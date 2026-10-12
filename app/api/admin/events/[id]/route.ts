import { NextResponse } from 'next/server';
import { isAdmin, isDirector } from '@/lib/auth';
import { getEvent } from '@/lib/store';
import { DomainError } from '@/lib/events';
import { errorResponse } from '@/lib/http';
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
