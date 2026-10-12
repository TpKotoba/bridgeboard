import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
export function authConfigured() {
  return (
    (process.env.ADMIN_PASSWORD?.length ?? 0) >= 16 &&
    (process.env.SESSION_SECRET?.length ?? 0) >= 32
  );
}
function safeEqual(a: string, b: string) {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}
export function passwordMatches(password: string) {
  return authConfigured() && safeEqual(password, process.env.ADMIN_PASSWORD!);
}
export function loginRole(password: string): 'admin' | 'director' | null {
  const director = process.env.DIRECTOR_PASSWORD;
  if (
    authConfigured() &&
    director &&
    director.length >= 16 &&
    director !== process.env.ADMIN_PASSWORD &&
    safeEqual(password, director)
  )
    return 'director';
  return passwordMatches(password) ? 'admin' : null;
}
function sign(value: string) {
  return createHmac('sha256', process.env.SESSION_SECRET!).update(value).digest('hex');
}
export function issueSession(role: 'admin' | 'director' = 'admin') {
  const payload = `${role}:${Date.now() + 8 * 60 * 60 * 1000}`;
  return `${payload}:${sign(payload)}`;
}
async function sessionRole() {
  if (!authConfigured()) return null;
  const token = (await cookies()).get('bridge_admin')?.value;
  if (!token) return null;
  const [name, expiry, signature] = token.split(':');
  return (name === 'admin' || name === 'director') &&
    Number(expiry) > Date.now() &&
    !!signature &&
    safeEqual(signature, sign(`${name}:${expiry}`))
    ? name
    : null;
}
export async function isAdmin() {
  return (await sessionRole()) !== null;
}
export async function isDirector() {
  return (await sessionRole()) === 'director';
}
