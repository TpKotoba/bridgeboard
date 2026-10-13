import { NextResponse } from 'next/server';
import { authConfigured, isAdmin, isDirector, issueSession, loginRole } from '@/lib/auth';
import { storageMode } from '@/lib/store';
import { checkOrigin, errorResponse, readJson } from '@/lib/http';
import { DomainError } from '@/lib/events';
import { limitLogin } from '@/lib/login-limit';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    return NextResponse.json(
      {
        admin: await isAdmin(),
        director: await isDirector(),
        configured: authConfigured(),
        storage: storageMode(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    if (!authConfigured()) throw new DomainError('請先設定 ADMIN_PASSWORD 與 SESSION_SECRET', 503);
    const body = await readJson(request);
    await limitLogin(request);
    const role =
      typeof body.password === 'string' && body.password.length <= 200
        ? loginRole(body.password)
        : null;
    if (typeof body.password !== 'string' || body.password.length > 200 || !role) {
      await new Promise((r) => setTimeout(r, 800));
      throw new DomainError('密碼不正確', 401);
    }
    const res = NextResponse.json(
      { ok: true, director: role === 'director' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
    res.cookies.set('bridge_admin', issueSession(role!), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 28800,
    });
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const res = NextResponse.json({ ok: true });
    res.cookies.delete('bridge_admin');
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
