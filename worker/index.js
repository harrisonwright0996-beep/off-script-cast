// The cast's one small server. It hands sealed packs to phones that have the company code, sends
// reminders, and keeps each pupil's latest numbers for the director. It never sees a name, a line or a
// message: packs are sealed before they get here, it holds only hashes of the tokens, a reminder is an
// empty push and the phone writes the words, and a pupil's name comes sealed with the company code.
// KV: file:<name> sealed bytes; sub:<id> { endpoint, nextAt, tries }, with nextAt in the metadata;
// prog:<id>, an empty value with the numbers in the metadata, so one list reads them all.
// LIMIT: a rate limit by address, for wrong tokens. WRITES: a higher one for writes with the right token,
// as a whole class can share one address. Neither stores anything here.
// Secrets: TOKEN_HASH, STAFF_HASH, VAPID_PUBLIC, VAPID_PRIVATE_JWK, VAPID_SUB. CLOSED = '1' after the show: every
// /f/ request answers 410, so each phone learns the pack is gone, and each tick clears what is left.
const HOUR = 3600;
const DAY = 86400000;
const RETRY_DAYS = [2, 3]; // after a reminder that was not opened; then it stops
const MAX_TICK = 40; // the free plan allows 50 fetches a run
const ROW_ENDS = Date.UTC(2027, 1, 1) / 1000; // the day after phones wipe themselves (ENDS): nothing outlasts it
const ROW_GAP = 5 * 60000; // a pupil's row is rewritten at most this often: free writes are limited
const NEXT_NEAR = HOUR * 1000; // a next reminder this close to the one saved is not worth a write
const PURGE = 400; // keys cleared in one tick after the show
const PUSH_HOSTS = /^https:\/\/(web\.push\.apple\.com|fcm\.googleapis\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com)\//;

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const text = (s) => new TextEncoder().encode(s);

async function sha256(s) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', text(s)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const cors = (env) => ({
  'Access-Control-Allow-Origin': env.ORIGIN,
  'Access-Control-Allow-Headers': 'content-type, x-cast-token, x-staff-token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  Vary: 'Origin',
});

// Whether this moment is one a reminder can go out: after school, not late, in UK time.
export function inWindow(now) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const get = (type) => parts.find((p) => p.type === type).value;
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  const weekend = ['Sat', 'Sun'].includes(get('weekday'));
  return weekend ? minutes >= 600 && minutes < 1200 : minutes >= 960 && minutes < 1230;
}

const addressOf = (request) => request.headers.get('cf-connecting-ip') || 'unknown';
const withinLimit = async (request, env) => (await env.LIMIT.limit({ key: addressOf(request) })).success;
const withinWrites = async (request, env) => (await env.WRITES.limit({ key: addressOf(request) })).success;

// The right token always passes, whatever has happened on that address.
async function authorised(request, env) {
  const token = request.headers.get('x-cast-token') || '';
  if ((await sha256(token)) === env.TOKEN_HASH) return { ok: true };
  return { ok: false, status: (await withinLimit(request, env)) ? 401 : 429 };
}

// One pupil's numbers, of the right kind, or null. Nothing else in the body is kept.
const is = (v, pattern) => typeof v === 'string' && pattern.test(v);
const isId = (v) => is(v, /^[a-f0-9]{32}$/);
const DAY_FORM = /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// who is left out by a phone not yet updated: the row then shows the part. onWay likewise.
function progressRow(b, now) {
  const count = (n) => Number.isInteger(n) && n >= 0 && n <= 5000;
  const good = isId(b?.id) && is(b.pack, /^p[a-f0-9]{32}$/) && (b.who === undefined || is(b.who, /^[A-Za-z0-9+/=]{1,260}$/)) && (b.scenes === undefined || is(b.scenes, /^[A-Za-z0-9+/=]{1,480}$/)) && Number.isInteger(b.percent) && b.percent >= 0 && b.percent <= 100 && count(b.learnt) && count(b.total) && b.learnt <= b.total && count(b.fading) && (b.onWay === undefined || count(b.onWay));
  if (!good || (b.lastDay !== null && !is(b.lastDay, DAY_FORM))) return null;
  const row = { id: b.id, pack: b.pack, percent: b.percent, learnt: b.learnt, total: b.total, fading: b.fading, lastDay: b.lastDay, seen: now };
  if (b.who !== undefined) row.who = b.who;
  if (b.onWay !== undefined) row.onWay = b.onWay;
  if (b.scenes !== undefined) row.scenes = b.scenes;
  if (Number.isInteger(b.streak) && b.streak >= 0 && b.streak <= 5000) row.streak = b.streak;
  if (typeof b.reminders === 'boolean') row.reminders = b.reminders;
  return row;
}

// The director's view: every pupil's numbers, for the one staff token.
async function staffRows(env) {
  const rows = [];
  let cursor;
  do {
    const page = await env.KV.list({ prefix: 'prog:', cursor });
    rows.push(...page.keys.map((k) => k.metadata).filter(Boolean));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return rows;
}

const putSub = (env, id, sub) => env.KV.put(`sub:${id}`, JSON.stringify(sub), { metadata: { nextAt: sub.nextAt } });

export async function handle(request, env) {
  const head = cors(env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: head });
  const url = new URL(request.url);
  const reply = (status, body = null, extra = {}) => new Response(body, { status, headers: { ...head, ...extra } });
  // After the show. A preflight above still passes, or the browser would never see this answer.
  if (env.CLOSED === '1' && (url.pathname.startsWith('/f/') || url.pathname === '/progress')) return reply(410);
  if (url.pathname === '/staff' || url.pathname === '/staff/remove') {
    const right = !!env.STAFF_HASH && (await sha256(request.headers.get('x-staff-token') || '')) === env.STAFF_HASH;
    if (!right) return reply((await withinLimit(request, env)) ? 401 : 429);
    if (url.pathname === '/staff' && request.method === 'GET') return reply(200, JSON.stringify(await staffRows(env)), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    if (url.pathname === '/staff' || request.method !== 'POST') return reply(405);
    const id = (await request.json().catch(() => null))?.id;
    if (!isId(id)) return reply(400);
    await env.KV.delete(`prog:${id}`);
    return reply(204);
  }
  const known =/^\/f\/[A-Za-z0-9_-]{1,64}$/.test(url.pathname) || /^\/push\/(sub|next|off)$/.test(url.pathname) || /^\/progress(\/off)?$/.test(url.pathname);
  if (!known) return reply(404);
  const who = await authorised(request, env);
  if (!who.ok) return reply(who.status);

  if (url.pathname.startsWith('/f/') && request.method === 'GET') {
    const file = await env.KV.get(`file:${url.pathname.slice(3)}`, 'arrayBuffer');
    return file ? reply(200, file, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' }) : reply(404);
  }
  if (request.method !== 'POST') return reply(405);
  let body;
  try {
    body = await request.json();
  } catch {
    return reply(400);
  }
  if (!(await withinWrites(request, env))) return reply(429);
  if (url.pathname === '/progress') {
    const row = progressRow(body, Date.now());
    if (!row) return reply(400);
    // Too soon after the last one: the phone keeps the numbers and tries again when next it can.
    const { metadata: old } = await env.KV.getWithMetadata(`prog:${row.id}`);
    if (old && row.seen - old.seen < ROW_GAP) return reply(429);
    await env.KV.put(`prog:${row.id}`, '', { metadata: row, expiration: ROW_ENDS });
    return reply(204);
  }
  if (!isId(body?.id)) return reply(400);
  if (url.pathname === '/progress/off') {
    await env.KV.delete(`prog:${body.id}`);
    return reply(204);
  }
  if (url.pathname === '/push/off') {
    await env.KV.delete(`sub:${body.id}`);
    return reply(204);
  }
  if (!Number.isFinite(body.nextAt)) return reply(400);
  if (url.pathname === '/push/sub') {
    if (typeof body.endpoint !== 'string' || !PUSH_HOSTS.test(body.endpoint)) return reply(400);
    await putSub(env, body.id, { endpoint: body.endpoint, nextAt: body.nextAt, tries: 0 });
    return reply(204);
  }
  const old = await env.KV.get(`sub:${body.id}`, 'json');
  if (!old) return reply(404);
  if (old.tries || Math.abs(old.nextAt - body.nextAt) >= NEXT_NEAR) await putSub(env, body.id, { ...old, nextAt: body.nextAt, tries: 0 });
  return reply(204);
}

// The signature a push service asks for (VAPID), good for 12 hours, so one tick needs one for each
// service, however many phones it reaches. made: those made so far this tick.
function vapid(endpoint, env, now, made) {
  const aud = new URL(endpoint).origin;
  if (!made.has(aud)) made.set(aud, signVapid(aud, env, now));
  return made.get(aud);
}

async function signVapid(aud, env, now) {
  const head = b64url(text(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(text(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * HOUR, sub: env.VAPID_SUB })));
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, text(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64url(sig)}, k=${env.VAPID_PUBLIC}`;
}

async function allSubs(env) {
  const keys = [];
  let cursor;
  do {
    const page = await env.KV.list({ prefix: 'sub:', cursor });
    keys.push(...page.keys);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return keys;
}

// One reminder. The new state is saved first, so a failure here cannot send it again every tick; a
// bad moment at the push service waits for the next try. Returns whether it went.
async function remind(env, name, now, send, made) {
  const sub = await env.KV.get(name, 'json');
  if (!sub) return false;
  if (sub.tries >= RETRY_DAYS.length) await env.KV.delete(name); // not opened three times: stop
  else await putSub(env, name.slice('sub:'.length), { ...sub, nextAt: now + RETRY_DAYS[sub.tries] * DAY, tries: sub.tries + 1 });
  const res = await send(sub.endpoint, { method: 'POST', headers: { Authorization: await vapid(sub.endpoint, env, now, made), TTL: '86400', Urgency: 'normal', 'Content-Length': '0' } });
  if (res.status >= 400 && res.status < 500 && res.status !== 429) await env.KV.delete(name); // the phone has said no, or gone
  return res.ok;
}

// After the show: reminders stop, and pupils' numbers and subscriptions go, a few at a time. Returns 0.
async function purge(env) {
  for (const prefix of ['prog:', 'sub:']) {
    const { keys } = await env.KV.list({ prefix, limit: PURGE });
    await Promise.all(keys.map(({ name }) => env.KV.delete(name)));
  }
  return 0;
}

// Every 15 minutes: the reminders that are due and may go out now, oldest first. Any left over wait
// for the next tick. One that throws never stops the others.
export async function tick(env, now, send = fetch) {
  if (env.CLOSED === '1') return purge(env);
  if (!inWindow(now)) return 0;
  const due = (await allSubs(env)).filter(({ metadata }) => metadata && metadata.nextAt <= now).sort((a, b) => a.metadata.nextAt - b.metadata.nextAt).slice(0, MAX_TICK);
  let sent = 0;
  const made = new Map();
  for (const { name } of due) {
    try {
      if (await remind(env, name, now, send, made)) sent += 1;
    } catch {
      // the state is saved: this one waits for its next try
    }
  }
  return sent;
}

export default {
  fetch: (request, env) => handle(request, env),
  scheduled: (event, env, ctx) => ctx.waitUntil(tick(env, Date.now())),
};
