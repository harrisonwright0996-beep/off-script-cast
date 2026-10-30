import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');
const ls = (dir, ext) => readdirSync(new URL(dir + '/', root)).filter((f) => f.endsWith(ext)).map((f) => `${dir}/${f}`);

test('the offline cache lists every app file, and only those', () => {
  const listed = [...read('sw.js').matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]);
  // docx.js, build.js and subset.js are only used on the laptop, to make packs.
  const laptop = ['src/docx.js', 'src/cast/build.js', 'src/cast/subset.js'];
  const want = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'vendor/fflate.js', ...ls('src', '.js'), ...ls('src/cast', '.js'), ...ls('src/ui', '.js'), ...ls('icons', '.png')].filter((f) => !laptop.includes(f));
  assert.deepEqual([...listed].sort(), want.sort());
});

test('everything the app imports is in the offline cache, so it opens with no signal', () => {
  const listed = new Set([...read('sw.js').matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]));
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const [, dep] of read(file).matchAll(/from '(\.[^']+)'/g)) visit(new URL(dep, new URL(file, 'http://x/')).pathname.slice(1));
  };
  visit('src/app.js');
  assert.deepEqual([...seen].filter((f) => !listed.has(f)), []);
});

test('the page can reach only its own worker, and has no inline script or style', () => {
  const html = read('index.html');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.equal(csp, "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://off-script-cast.example.workers.dev; object-src 'none'; base-uri 'none'; form-action 'none'");
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, 'no inline scripts');
  assert.doesNotMatch(html, /<style|\sstyle=/, 'no inline styles');
  for (const f of [...ls('src', '.js'), ...ls('src/cast', '.js'), ...ls('src/ui', '.js')]) {
    if (f === 'src/cast/client.js') continue; // the one file that talks to the worker
    assert.doesNotMatch(read(f), /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/, `${f} sends nothing`);
  }
});

test('no italics anywhere', () => {
  assert.match(read('styles.css'), /font-style: normal !important/);
  for (const f of [...ls('src/ui', '.js'), 'index.html']) assert.doesNotMatch(read(f), /<(i|em)>|'(i|em)'/, `${f} uses no italic elements`);
});
