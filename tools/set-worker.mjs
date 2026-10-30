#!/usr/bin/env node
// Points the app at the live worker: the address and public push key in src/cast/config.js, and the
// address wherever the page's Content Security Policy or its tests name it. Neither is secret.
//
//   node tools/set-worker.mjs --url https://off-script-cast.<name>.workers.dev --vapid <public key>
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const FILES = ['src/cast/config.js', 'index.html', 'tests/sw.test.mjs', 'e2e/helpers.mjs'];

export function setWorker(text, url, vapid) {
  return text
    .replace(/https:\/\/off-script-cast\.[a-z0-9-]+\.workers\.dev/g, url)
    .replace(/export const VAPID_PUBLIC = '[^']*';/, `export const VAPID_PUBLIC = '${vapid}';`);
}

async function main(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!/^https:\/\/off-script-cast\.[a-z0-9-]+\.workers\.dev$/.test(opt.url || '') || !opt.vapid) throw new Error('Usage: node tools/set-worker.mjs --url https://off-script-cast.<name>.workers.dev --vapid <public key>');
  for (const name of FILES) {
    const path = REPO + name;
    await writeFile(path, setWorker(await readFile(path, 'utf8'), opt.url, opt.vapid));
  }
  console.log(`Set in ${FILES.length} files.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`Failed: ${err.message}`);
    process.exit(1);
  });
}
