import 'server-only';
import { createHash,createHmac,timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
export function authConfigured(){return (process.env.ADMIN_PASSWORD?.length??0)>=16&&(process.env.SESSION_SECRET?.length??0)>=32;}
function safeEqual(a:string,b:string){return timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());}
export function passwordMatches(password:string){return authConfigured()&&safeEqual(password,process.env.ADMIN_PASSWORD!);}
function sign(value:string){return createHmac('sha256',process.env.SESSION_SECRET!).update(value).digest('hex');}
export function issueSession(){const payload=`admin:${Date.now()+8*60*60*1000}`;return `${payload}:${sign(payload)}`;}
export async function isAdmin(){
  if(!authConfigured())return false;
  const token=(await cookies()).get('bridge_admin')?.value;if(!token)return false;
  const [name,expiry,signature]=token.split(':');
  return name==='admin'&&Number(expiry)>Date.now()&&!!signature&&safeEqual(signature,sign(`${name}:${expiry}`));
}
