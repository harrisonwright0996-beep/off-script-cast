import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, inWindow, tick } from '../worker/index.js';
import { tokenHash } from '../src/cast/pack.js';

const TOKEN = 'a'.repeat(64);
const APPLE = 'https://web.push.apple.com/abc';
const ID = 'f'.repeat(32);

// The Cloudflare rate limit: ten a key, and it keeps nothing a test could read but the keys it saw.
function fakeLimit() {
  const seen = new Map();
  return {
    seen,
    limit: async ({ key }) => {
      seen.set(key, (seen.get(key) || 0) + 1);
      return { success: seen.get(key) <= 10 };
    },
  };
}

function fakeKV() {
  const m = new Map();
  return {
    m,
    get: async (k, type) => {
      const e = m.get(k);
      if (!e) return null;
      return type === 'json' ? JSON.parse(e.v) : e.v;
    },
    put: async (k, v, o = {}) => void m.set(k, { v, metadata: o.metadata }),
    delete: async (k) => void m.delete(k),
    list: async ({ prefix }) => ({ keys: [...m].filter(([k]) => k.startsWith(prefix)).map(([name, e]) => ({ name, metadata: e.metadata })), list_complete: true }),
  };
}

async function env() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    KV: fakeKV(),
    LIMIT: fakeLimit(),
    ORIGIN: 'https://example.github.io',
    TOKEN_HASH: await tokenHash(TOKEN),
    VAPID_PUBLIC: 'pub',
    VAPID_SUB: 'https://example.github.io/',
    VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)),
  };
}

const call = (e, path, { token = TOKEN, method = 'GET', body, ip = '1.1.1.1' } = {}) =>
  handle(new Request(`https://w.dev${path}`, { method, headers: { 'x-cast-token': token, 'cf-connecting-ip': ip, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }), e);

// Wednesday 4 November 2026 at 17:00 UK time; 12:00 is in school, 22:00 is too late.
const AT = Date.UTC(2026, 10, 4, 17);

test('a pack comes only with the right token', async () => {
  const e = await env();
  await e.KV.put('file:cast', 'sealed');
  assert.equal((await call(e, '/f/cast', { token: 'wrong' })).status, 401);
  const ok = await call(e, '/f/cast');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), e.ORIGIN);
  assert.equal((await call(e, '/f/nothing')).status, 404);
  assert.equal((await call(e, '/elsewhere')).status, 404);
});

test('ten wrong tokens stop that address, but only for wrong tokens and only that address', async () => {
  const e = await env();
  await e.KV.put('file:cast', 'sealed');
  for (let i = 0; i < 10; i++) assert.equal((await call(e, '/f/cast', { token: 'wrong' })).status, 401);
  assert.equal((await call(e, '/f/cast', { token: 'wrong' })).status, 429);
  assert.equal((await call(e, '/f/cast')).status, 200); // a pupil on the same school wifi
  assert.equal((await call(e, '/f/cast', { token: 'wrong', ip: '2.2.2.2' })).status, 401);
});

test('a right token costs the limit nothing; a wrong guess writes nothing and keeps no address', async () => {
  const e = await env();
  await e.KV.put('file:cast', 'sealed');
  for (let i = 0; i < 20; i++) await call(e, '/f/cast');
  assert.equal(e.LIMIT.seen.size, 0);
  const before = [...e.KV.m.keys()];
  await call(e, '/f/cast', { token: 'wrong', ip: '9.8.7.6' });
  assert.deepEqual([...e.KV.m.keys()], before);
  assert.deepEqual([...e.LIMIT.seen.keys()], ['9.8.7.6']);
});

test('new subscriptions are limited by address, and a refused one is not stored', async () => {
  const e = await env();
  const sub = (id, ip) => call(e, '/push/sub', { method: 'POST', ip, body: { id, endpoint: APPLE, nextAt: AT } });
  assert.equal((await call(e, '/push/sub', { method: 'POST', body: { id: ID, endpoint: 'https://evil.example/x', nextAt: AT } })).status, 400);
  assert.equal(e.LIMIT.seen.size, 0); // only one that would be stored counts
  for (let i = 0; i < 10; i++) assert.equal((await sub(ID, '1.1.1.1')).status, 204);
  const other = 'e'.repeat(32);
  assert.equal((await sub(other, '1.1.1.1')).status, 429);
  assert.equal(e.KV.m.has(`sub:${other}`), false);
  assert.equal((await sub(other, '2.2.2.2')).status, 204);
});

test('a POST of JSON null, or of anything else that is not a record, is a bad request', async () => {
  const e = await env();
  const raw = (path, body) => handle(new Request(`https://w.dev${path}`, { method: 'POST', headers: { 'x-cast-token': TOKEN }, body }), e);
  for (const path of ['/push/sub', '/push/next', '/push/off']) {
    for (const body of ['null', '5', '[]', 'not json']) assert.equal((await raw(path, body)).status, 400, `${path} ${body}`);
  }
});

test('closed after the show: every /f/ request is 410, ahead of the token, and the browser can read it', async () => {
  const e = await env();
  e.CLOSED = '1';
  await e.KV.put('file:cast', 'sealed');
  const res = await call(e, '/f/cast');
  assert.equal(res.status, 410);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), e.ORIGIN);
  assert.equal((await call(e, '/f/cast', { token: 'wrong' })).status, 410);
  assert.equal((await call(e, '/f/not!a!name')).status, 410);
  assert.equal(e.LIMIT.seen.size, 0);
  // The token is a custom header, so the browser asks first; a failed preflight would look like no signal.
  assert.equal((await call(e, '/f/cast', { method: 'OPTIONS' })).status, 204);
  // Anything but '1' leaves it open, and reminders can still be turned off.
  e.CLOSED = '0';
  assert.equal((await call(e, '/f/cast')).status, 200);
  e.CLOSED = '1';
  assert.equal((await call(e, '/push/off', { method: 'POST', body: { id: ID } })).status, 204);
});

test('the phone hears 410 as gone', async () => {
  const { openCast, CastError } = await import('../src/cast/client.js');
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 410 });
  try {
    await assert.rejects(openCast({ token: 't', key: 'k' }), (err) => err instanceof CastError && err.code === 'gone');
  } finally {
    globalThis.fetch = real;
  }
});

test('a pack name comes from the token and the name: 32 hex characters, the same every run', async () => {
  const { packFile } = await import('../tools/make-packs.mjs');
  const name = packFile('a'.repeat(128), 'Ferry Captain');
  assert.match(name, /^p[a-f0-9]{32}$/);
  assert.equal(packFile('a'.repeat(128), 'Ferry Captain'), name);
  assert.notEqual(packFile('b'.repeat(128), 'Ferry Captain'), name);
  assert.notEqual(packFile('a'.repeat(128), 'Deckhand'), name);
  const { createHash } = await import('node:crypto');
  assert.equal(name, `p${createHash('sha256').update(`${'a'.repeat(128)}|Ferry Captain`).digest('hex').slice(0, 32)}`);
});

test('a subscription holds only the address and time, and only for real push services', async () => {
  const e = await env();
  assert.equal((await call(e, '/push/sub', { method: 'POST', body: { id: ID, endpoint: 'https://evil.example/x', nextAt: AT } })).status, 400);
  assert.equal((await call(e, '/push/sub', { method: 'POST', body: { id: ID, endpoint: APPLE, nextAt: AT, name: 'x' } })).status, 204);
  assert.deepEqual(JSON.parse(e.KV.m.get(`sub:${ID}`).v), { endpoint: APPLE, nextAt: AT, tries: 0 });
});

test('reminder times', () => {
  assert.equal(inWindow(AT), true);
  assert.equal(inWindow(Date.UTC(2026, 10, 4, 12)), false);
  assert.equal(inWindow(Date.UTC(2026, 10, 4, 22)), false);
  assert.equal(inWindow(Date.UTC(2026, 10, 7, 11)), true); // a Saturday morning
  assert.equal(inWindow(Date.UTC(2026, 10, 7, 21)), false);
  assert.equal(inWindow(Date.UTC(2026, 6, 1, 15, 30)), true); // July: 16:30 in the UK
});

test('a due reminder is one empty, signed push; then two tries; then it stops', async () => {
  const e = await env();
  await call(e, '/push/sub', { method: 'POST', body: { id: ID, endpoint: APPLE, nextAt: AT - 1 } });
  const sent = [];
  const send = async (url, init) => (sent.push({ url, init }), new Response(null, { status: 201 }));
  assert.equal(await tick(e, AT, send), 1);
  assert.equal(sent[0].init.body, undefined);
  assert.match(sent[0].init.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=pub$/);
  assert.equal(await tick(e, AT, send), 0); // not again the same day
  const two = JSON.parse(e.KV.m.get(`sub:${ID}`).v).nextAt;
  assert.equal(two, AT + 2 * 86400000);
  await tick(e, two, send);
  const three = JSON.parse(e.KV.m.get(`sub:${ID}`).v).nextAt;
  assert.equal(three, two + 3 * 86400000);
  await tick(e, three, send);
  assert.equal(e.KV.m.has(`sub:${ID}`), false);
  assert.equal(sent.length, 3);
});

test('nothing goes out in school hours, and a gone phone is forgotten', async () => {
  const e = await env();
  await call(e, '/push/sub', { method: 'POST', body: { id: ID, endpoint: APPLE, nextAt: 1 } });
  assert.equal(await tick(e, Date.UTC(2026, 10, 4, 12), async () => assert.fail('sent')), 0);
  await tick(e, AT, async () => new Response(null, { status: 410 }));
  assert.equal(e.KV.m.has(`sub:${ID}`), false);
});

const subAt = (e, id, nextAt, tries = 0) => e.KV.put(`sub:${id}`, JSON.stringify({ endpoint: `${APPLE}/${id}`, nextAt, tries }), { metadata: { nextAt } });
const idOf = (i) => i.toString(16).padStart(32, '0');

test('at most 40 a tick, oldest first, and the rest go on the next', async () => {
  const e = await env();
  for (let i = 45; i > 0; i--) await subAt(e, idOf(i), i);
  const sent = [];
  const send = async (url) => (sent.push(url), new Response(null, { status: 201 }));
  assert.equal(await tick(e, AT, send), 40);
  assert.deepEqual(sent, Array.from({ length: 40 }, (_, i) => `${APPLE}/${idOf(i + 1)}`));
  assert.equal(await tick(e, AT, send), 5);
  assert.equal(new Set(sent).size, 45);
});

test('one that throws stops no other, and is not sent again every tick', async () => {
  const e = await env();
  await subAt(e, idOf(1), 1);
  await subAt(e, idOf(2), 2);
  await subAt(e, 'broken', 0);
  e.KV.m.get('sub:broken').v = 'not json';
  const sent = [];
  const send = async (url) => {
    sent.push(url);
    if (url.endsWith(idOf(1))) throw new Error('no route');
    return new Response(null, { status: 201 });
  };
  assert.equal(await tick(e, AT, send), 1);
  assert.equal(sent.length, 2);
  await tick(e, AT, send);
  assert.equal(sent.length, 2);
  assert.equal(JSON.parse(e.KV.m.get(`sub:${idOf(1)}`).v).nextAt, AT + 2 * 86400000);
});

test('the state is saved before the push goes', async () => {
  const e = await env();
  await subAt(e, ID, 1);
  await subAt(e, 'e'.repeat(32), 2, 2); // its last try
  const seen = [];
  await tick(e, AT, async (url) => {
    seen.push(e.KV.m.has(url.includes(ID) ? `sub:${ID}` : `sub:${'e'.repeat(32)}`) && JSON.parse(e.KV.m.get(`sub:${ID}`).v).tries);
    return new Response(null, { status: 201 });
  });
  assert.deepEqual(seen, [1, false]);
});

test('what the push service answers: 4xx forgets the phone, 429 and 5xx do not', async () => {
  for (const [status, kept] of [[400, false], [403, false], [404, false], [410, false], [413, false], [429, true], [500, true], [503, true]]) {
    const e = await env();
    await subAt(e, ID, 1);
    assert.equal(await tick(e, AT, async () => new Response(null, { status })), 0, `${status}`);
    assert.equal(e.KV.m.has(`sub:${ID}`), kept, `${status}`);
    if (kept) assert.equal(await tick(e, AT, async () => assert.fail('sent again')), 0); // waits for its next try
  }
});

test('opening the app resets the tries; off deletes the record', async () => {
  const e = await env();
  await call(e, '/push/sub', { method: 'POST', body: { id: ID, endpoint: APPLE, nextAt: 1 } });
  await tick(e, AT, async () => new Response(null, { status: 201 }));
  await call(e, '/push/next', { method: 'POST', body: { id: ID, nextAt: AT + 5 } });
  assert.deepEqual(JSON.parse(e.KV.m.get(`sub:${ID}`).v), { endpoint: APPLE, nextAt: AT + 5, tries: 0 });
  await call(e, '/push/off', { method: 'POST', body: { id: ID } });
  assert.equal(e.KV.m.has(`sub:${ID}`), false);
});

test('push keys work with the worker, and the public key is the raw P-256 point', async () => {
  const { makeVapid } = await import('../tools/worker-setup.mjs');
  const { jwk, publicKey } = await makeVapid();
  assert.equal(Buffer.from(publicKey, 'base64url').length, 65);
  assert.equal(jwk.crv, 'P-256');
  assert.ok(jwk.d);
});

test('setting the worker changes the address and the key, and nothing else', async () => {
  const { setWorker } = await import('../tools/set-worker.mjs');
  const before = "export const WORKER = 'https://off-script-cast.example.workers.dev';\nexport const VAPID_PUBLIC = '';\n";
  assert.equal(setWorker(before, 'https://off-script-cast.abc.workers.dev', 'KEY'), "export const WORKER = 'https://off-script-cast.abc.workers.dev';\nexport const VAPID_PUBLIC = 'KEY';\n");
});
