import { NextResponse } from 'next/server';
export function GET() {
  return NextResponse.json(
    { status: 'ok', version: '0.1.0' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
