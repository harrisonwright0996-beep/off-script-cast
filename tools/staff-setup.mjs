#!/usr/bin/env node
// Laptop only, after `npx wrangler login`. Makes the director's staff code once (kept as staff.txt in
// the private folder, mode 600) and gives the worker its hash. Prints nothing secret.
//
//   node tools/staff-setup.mjs --out <private folder>
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER = fileURLToPath(new URL('../worker/', import.meta.url));
const at = process.argv.indexOf('--out');
if (at < 0 || !process.argv[at + 1]) throw new Error('Usage: node tools/staff-setup.mjs --out <private folder>');
const file = join(resolve(process.argv[at + 1]), 'staff.txt');

if (!existsSync(file)) {
  await writeFile(file, `${randomBytes(16).toString('hex').match(/.{4}/g).join('-')}\n`);
  await chmod(file, 0o600);
}
const code = (await readFile(file, 'utf8')).trim();
await new Promise((ok, fail) => {
  const child = spawn('npx', ['wrangler', 'secret', 'put', 'STAFF_HASH'], { cwd: WORKER, stdio: ['pipe', 'ignore', 'ignore'] });
  child.on('error', fail);
  child.on('close', (status) => (status === 0 ? ok() : fail(new Error('Could not set STAFF_HASH.'))));
  child.stdin.end(createHash('sha256').update(code).digest('hex'));
});
console.log('Staff code ready.');
