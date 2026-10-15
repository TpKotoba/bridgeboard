import { NextResponse } from 'next/server';
import { isDirector } from '@/lib/auth';
import { checkOrigin, errorResponse, readJson } from '@/lib/http';
import { DomainError } from '@/lib/events';
import { deletionSchema } from '@/lib/competition-deletion';
import { deleteCompetitions } from '@/lib/store';

export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    if (!(await isDirector())) throw new DomainError('此操作僅限裁判', 403);
    const input = deletionSchema.parse(await readJson(request));
    const deleted = await deleteCompetitions(input);
    return NextResponse.json({ deleted }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
