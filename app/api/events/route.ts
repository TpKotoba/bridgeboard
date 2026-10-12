import { NextResponse } from 'next/server';
import { createSchema } from '@/lib/model';
import { createEvent } from '@/lib/events';
import { insertEvent, listEvents, storageMode } from '@/lib/store';
import { errorResponse, readJson, requireAdmin } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const data = await listEvents();
    return NextResponse.json(
      {
        storage: storageMode(),
        events: data.map(({ event: e, projection: p }) => ({
          id: e.id,
          name: e.name,
          kind: e.kind,
          pairMethod: e.pairMethod ?? 'mp',
          date: e.date,
          venue: e.venue,
          status: e.status,
          demo: e.demo,
          participants: e.participants.length,
          rounds: e.rounds,
          boards: e.boards.length,
          received: p.received,
          expected: p.expected,
        })),
      },
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=15' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const event = createEvent(createSchema.parse(await readJson(request)));
    await insertEvent(event);
    return NextResponse.json({ id: event.id }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
