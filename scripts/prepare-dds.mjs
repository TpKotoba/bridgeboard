import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
await mkdir('public/vendor/dds/lib', { recursive: true });
const api = await readFile('node_modules/bridge-dds/dist/api.js', 'utf8');
await writeFile('public/vendor/dds/api.js', api.replace('"./lib/dds"', '"./lib/dds.js"'));
await copyFile('node_modules/bridge-dds/dist/lib/dds.js', 'public/vendor/dds/lib/dds.js');
await copyFile('node_modules/bridge-dds/LICENSE', 'public/vendor/dds/LICENSE');
