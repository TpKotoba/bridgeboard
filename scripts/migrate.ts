import { neon } from '@neondatabase/serverless';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
if(!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before running migrations.');
const sql=neon(process.env.DATABASE_URL);
async function main(){
  await sql`CREATE TABLE IF NOT EXISTS bridge_events (id text PRIMARY KEY, revision integer NOT NULL CHECK (revision > 0), document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS bridge_login_limits (key text PRIMARY KEY, attempts integer NOT NULL, window_end timestamptz NOT NULL)`;
  console.log('Migration complete: bridge_events');
}
main().catch(()=>{console.error('Migration failed. Check connection and database permissions.');process.exitCode=1;});
