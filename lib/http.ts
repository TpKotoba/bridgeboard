import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { DomainError } from './events';
import { isAdmin } from './auth';
export async function requireAdmin(request: Request) {
  checkOrigin(request);
  if (!(await isAdmin())) throw new DomainError('請先登入裁判／賽務後台', 401);
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get('origin');
  try {
    const url = new URL(origin ?? '');
    // Next's internal request.url can use localhost even when the browser uses 127.0.0.1.
    // Host is supplied by the actual incoming request; do not trust x-forwarded-host.
    if (
      url.host !== request.headers.get('host') ||
      url.protocol !== (process.env.VERCEL ? 'https:' : new URL(request.url).protocol)
    )
      throw new Error('origin');
  } catch {
    throw new DomainError('來源驗證失敗', 403);
  }
}
export async function readJson(request: Request) {
  if (Number(request.headers.get('content-length') ?? 0) > 500000)
    throw new DomainError('資料超過 500 KB 上限', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError('缺少請求內容');
  let total = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 500000) {
      await reader.cancel();
      throw new DomainError('資料超過 500 KB 上限', 413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DomainError('JSON 格式錯誤');
  }
}
export function errorResponse(error: unknown) {
  if (error instanceof ZodError)
    return NextResponse.json(
      { error: error.issues[0].message },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  if (error instanceof DomainError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status, headers: { 'Cache-Control': 'no-store' } },
    );
  console.error('Request failed:', error instanceof Error ? error.name : 'UnknownError');
  return NextResponse.json(
    { error: '操作失敗。請檢查資料格式或伺服器／資料庫設定，原有成績仍保留。' },
    { status: 500, headers: { 'Cache-Control': 'no-store' } },
  );
}
