import 'server-only';
import { createHmac } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { DomainError } from './events';
const localAttempts=new Map<string,{count:number;until:number}>();
export async function limitLogin(request:Request) {
  const ip=(request.headers.get('x-vercel-forwarded-for')??request.headers.get('x-forwarded-for')??'local').split(',')[0].trim();
  const key=createHmac('sha256',process.env.SESSION_SECRET!).update(ip).digest('hex');
  if(process.env.STORAGE_MODE==='neon'||process.env.DATABASE_URL) {
    if(!process.env.DATABASE_URL)throw new DomainError('尚未設定資料庫',503);
    const sql=neon(process.env.DATABASE_URL);
    const rows=await sql`INSERT INTO bridge_login_limits (key,attempts,window_end) VALUES (${key},1,now()+interval '10 minutes') ON CONFLICT (key) DO UPDATE SET attempts=CASE WHEN bridge_login_limits.window_end<now() THEN 1 ELSE bridge_login_limits.attempts+1 END, window_end=CASE WHEN bridge_login_limits.window_end<now() THEN now()+interval '10 minutes' ELSE bridge_login_limits.window_end END RETURNING attempts`;
    if(Number(rows[0].attempts)>10)throw new DomainError('登入嘗試次數過多，請於十分鐘後再試。',429);
  } else {
    const now=Date.now();for(const [k,v] of localAttempts)if(v.until<now)localAttempts.delete(k);
    const count=localAttempts.get(key)??{count:0,until:now+600000};count.count++;localAttempts.set(key,count);
    if(count.count>10)throw new DomainError('登入嘗試次數過多，請於十分鐘後再試。',429);
  }
}
