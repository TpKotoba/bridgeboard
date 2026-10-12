import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
if (process.env.VERCEL) throw new Error('Local storage cannot run on Vercel.');
const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      STORAGE_MODE: 'local',
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'local-bridge-admin-2026',
      DIRECTOR_PASSWORD: process.env.DIRECTOR_PASSWORD || 'local-bridge-director-2026',
      SESSION_SECRET: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
    },
  },
);
console.log('Local-only test mode. See README for the development login.');
child.on('exit', (code) => process.exit(code ?? 0));
