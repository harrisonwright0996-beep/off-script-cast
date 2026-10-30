import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, inWindow, tick } from '../worker/index.js';
import { tokenHash } from '../src/cast/pack.js';

const TOKEN = 'a'.repeat(64);
const APPLE = 'https://web.push.apple.com/abc';
const ID = 'f'.repeat(32);

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

test('ten wrong tokens stop that address, even with the right one, and only that address', async () => {
  const e = await env();
  await e.KV.put('file:cast', 'sealed');
  for (let i = 0; i < 10; i++) await call(e, '/f/cast', { token: 'wrong' });
  assert.equal((await call(e, '/f/cast')).status, 429);
  assert.equal((await call(e, '/f/cast', { ip: '2.2.2.2' })).status, 200);
});

test('no bad token entry holds the address itself', async () => {
  const e = await env();
  await call(e, '/f/cast', { token: 'wrong', ip: '9.8.7.6' });
  assert.ok([...e.KV.m.keys()].every((k) => !k.includes('9.8.7.6')));
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
