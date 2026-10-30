#!/usr/bin/env node
// Laptop only, after `npx wrangler login`. Takes the private folder made by make-packs.mjs. Makes the
// push keys once (kept in that folder, mode 600), sets the worker's secrets and uploads every sealed
// file. Prints counts and the public push key only, never a secret or anything wrangler says.
//
//   node tools/worker-setup.mjs --out <private folder> --sub https://<the app's address> [--secrets-only]
import { execFile, spawn } from 'node:child_process';
import { chmod, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const WORKER = fileURLToPath(new URL('../worker/', import.meta.url));

export async function makeVapid() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { jwk, publicKey: Buffer.from(raw).toString('base64url') };
}

function secret(name, value) {
  return new Promise((ok, fail) => {
    const child = spawn('npx', ['wrangler', 'secret', 'put', name], { cwd: WORKER, stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', fail);
    child.on('close', (code) => (code === 0 ? ok() : fail(new Error(`Could not set ${name}.`))));
    child.stdin.end(value);
  });
}

async function main(argv) {
  const secretsOnly = argv.includes('--secrets-only');
  const list = argv.filter((a) => a !== '--secrets-only');
  const opt = {};
  for (let i = 0; i < list.length; i += 2) opt[list[i].replace(/^--/, '')] = list[i + 1];
  if (!opt.out || !opt.sub) throw new Error('Usage: node tools/worker-setup.mjs --out <private folder> --sub https://<the app\'s address> [--secrets-only]');
  const out = resolve(opt.out);

  const vapidFile = join(out, 'vapid.json');
  if (!existsSync(vapidFile)) {
    await writeFile(vapidFile, JSON.stringify(await makeVapid()));
    await chmod(vapidFile, 0o600);
  }
  const { jwk, publicKey } = JSON.parse(await readFile(vapidFile, 'utf8'));

  await secret('TOKEN_HASH', (await readFile(join(out, 'token-hash.txt'), 'utf8')).trim());
  await secret('VAPID_PUBLIC', publicKey);
  await secret('VAPID_PRIVATE_JWK', JSON.stringify(jwk));
  await secret('VAPID_SUB', opt.sub);
  console.log('Secrets set.');

  if (!secretsOnly) {
    const names = await readdir(join(out, 'files'));
    for (const name of names) {
      await run('npx', ['wrangler', 'kv', 'key', 'put', `file:${name}`, '--path', join(out, 'files', name), '--binding', 'KV', '--remote'], { cwd: WORKER }).catch(() => {
        throw new Error('An upload failed. Nothing is wrong with the file; run this again.');
      });
    }
    console.log(`Uploaded ${names.length} files.`);
  }
  console.log(`Public push key: ${publicKey}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`Failed: ${err.message}`);
    process.exit(1);
  });
}
