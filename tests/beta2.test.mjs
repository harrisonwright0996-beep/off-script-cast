// What the second round of beta testing found, held in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeApp, learn } from './helpers.mjs';
import { createSession } from '../src/session.js';
import { createTypeCheck, makeResult, sameKey } from '../src/grade.js';
import { tokenize } from '../src/tokens.js';
import { newState } from '../src/state.js';
import { nextNudge } from '../src/cast/reminders.js';
import { chaseList, sameFirstName, sceneAverages, sceneList, staffRows } from '../src/ui/staff.js';
import { sceneLine } from '../src/cast/progress.js';
import { safariMenu } from '../src/device.js';
import { roundMinutes } from '../src/settings.js';
import { handle, tick } from '../worker/index.js';
import { tokenHash } from '../src/cast/pack.js';

const start = (app, opts = {}) => createSession({ model: app.model, index: app.index, getPlan: app.plan, getState: app.getState, settings: app.settings, now: app.now, ...opts });

test('no pattern in the app looks behind: iPhones before iOS 16.4 could not even start', () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(join(dir, f.name)) : f.name.endsWith('.js') ? [join(dir, f.name)] : []));
  for (const file of walk('src')) assert.equal(readFileSync(file, 'utf8').includes('(?<'), false, file);
});

test('dashes and sentences still split as before, with no lookbehind', () => {
  assert.deepEqual(tokenize('well-known—now').map((t) => t.d), ['well', 'known', 'now'].map((_, i) => tokenize('well-known—now')[i].d));
  assert.equal(tokenize('well-known').filter((t) => t.k).length, 2);
});

test('mirror and sound alike letters are accepted; other letters are not', () => {
  const key = (word, typed) => {
    const check = createTypeCheck(tokenize(word));
    check.press(typed);
    return check.misses.length === 0;
  };
  assert.equal(key('dog', 'b'), true);
  assert.equal(key('ones', 'w'), true);
  assert.equal(key('write', 'r'), true);
  assert.equal(key('254', 't'), true);
  assert.equal(key('dog', 'm'), false);
  assert.equal(sameKey('a', 'e'), false);
});

test('a line cannot count the day it was first met, however well it is typed', () => {
  const app = fakeApp({ today: '2026-10-27' });
  const id = app.model.items[0].id;
  const s = start(app);
  let c = s.advance();
  for (let i = 0; i < 40 && c; i++) {
    if (c.step === 'test') c = s.choose('teach');
    else if (c.step === 'front') c = s.choose('next');
    else {
      app.save(s.answer(makeResult({ misses: [], mode: 'type' })));
      c = s.advance();
    }
  }
  assert.ok(app.getState(id).passes >= 1);
  assert.equal(app.getState(id).proved, false);
});

test('a line just on show is not asked for proof, and cannot earn it', () => {
  const app = fakeApp({ today: '2026-10-27' });
  const id = app.model.items[0].id;
  learn(app, [id], { status: 'review', passes: 3, helped: 3, stability: 1, hoursAgo: 30, firstDay: '2026-10-25', lastResult: 'pass' });
  const s = start(app, { scope: 'tests', peeked: (x) => x === id });
  let c = s.advance();
  while (c.step !== 'floor') {
    app.save(s.answer(makeResult({ misses: [], mode: 'say' })));
    c = s.advance();
  }
  assert.equal(c.mustType, false);
  app.save(s.answer(makeResult({ misses: [], mode: 'type' })));
  assert.equal(app.getState(id).proved, false);
});

test('the same word wrong twice still passes, but neither grows nor proves the line, and it comes back with its letters', () => {
  const app = fakeApp({ today: '2026-10-27' });
  const it = app.model.items.find((x) => x.words >= 8);
  learn(app, [it.id], { status: 'review', passes: 3, helped: 3, stability: 5, hoursAgo: 30, firstDay: '2026-10-25', lastResult: 'pass', closeWord: 2 });
  const s = start(app, { scope: 'tests' });
  let c = s.advance();
  while (c.step !== 'floor') {
    app.save(s.answer(makeResult({ misses: [], mode: 'say' })));
    c = s.advance();
  }
  const before = app.getState(it.id).stability;
  const rec = s.answer(makeResult({ misses: [2], mode: 'type', words: it.words }));
  app.save(rec);
  assert.equal(rec.event.pass, true);
  assert.equal(rec.state.stability, before);
  assert.equal(rec.state.proved, false);
  assert.equal(rec.need, 'help');
});

test('a word wrong once, then a different word, grows as a near miss and can prove', () => {
  const app = fakeApp({ today: '2026-10-27' });
  const it = app.model.items.find((x) => x.words >= 8);
  learn(app, [it.id], { status: 'review', passes: 3, helped: 3, stability: 5, hoursAgo: 30, firstDay: '2026-10-25', lastResult: 'pass', closeWord: 2 });
  const s = start(app, { scope: 'tests' });
  let c = s.advance();
  while (c.step !== 'floor') {
    app.save(s.answer(makeResult({ misses: [], mode: 'say' })));
    c = s.advance();
  }
  const rec = s.answer(makeResult({ misses: [3], mode: 'type', words: it.words }));
  assert.equal(rec.state.proved, true);
  assert.equal(rec.state.closeWord, 3);
});

test('a round always ends: a line missed twice at time up waits for another day', () => {
  const app = fakeApp({ today: '2026-10-27' });
  const ids = app.model.items.slice(0, 3).map((it) => it.id);
  learn(app, ids, { status: 'review', passes: 3, helped: 3, stability: 1, hoursAgo: 30, firstDay: '2026-10-25', lastResult: 'pass' });
  const s = start(app, { scope: 'tests' });
  let c = s.advance();
  s.close();
  let goes = 0;
  while (c && goes < 60) {
    if (c.step === 'front') c = s.choose('next');
    else {
      app.save(s.answer(makeResult({ misses: [0], mode: 'type' })));
      goes += 1;
      c = s.advance();
    }
  }
  assert.equal(c, null);
  assert.ok(goes < 12, `${goes} goes`);
});

test('a secure pupil is reminded for the final days, not a week after their last round', () => {
  const app = fakeApp({ today: '2026-12-08', settings: { deadline: '2026-11-05', lastNewDay: '2026-11-04', showDay: '2026-12-14' } });
  for (const it of app.model.items) app.states.set(it.id, { ...newState(it.id), status: 'review', proved: true, passes: 9, stability: 5000, lastResult: 'pass', lastTime: app.clock, lastDay: app.today, passDays: [app.today] });
  const at = nextNudge({ model: app.model, getState: app.getState, now: app.clock, settings: app.settings });
  assert.equal(new Date(at).getDate(), 11);
});

test('the dashboard keeps a part in view until its own pupil starts, and marks understudies and the quiet', () => {
  const members = [{ file: 'pa', name: 'Ella B.' }, { file: 'pb', name: 'Sam T.' }];
  const today = '2026-11-20';
  const rows = staffRows(members, [
    { id: '1', pack: 'pa', who: 'Noor Khan', percent: 40, lastDay: '2026-11-19', seen: Date.parse('2026-11-19') },
    { id: '2', pack: 'pb', who: 'Sam Taylor', percent: 74, lastDay: '2026-11-01', seen: Date.parse('2026-11-01') },
    { id: '3', pack: 'gone', who: 'Old Name', percent: 5, lastDay: '2026-11-19', seen: Date.parse('2026-11-19') },
  ], today);
  assert.deepEqual(rows.map((r) => r.name), ['Ella B.', 'Sam Taylor', 'Old Name', 'Noor Khan'], 'not started, then quiet, then lowest %');
  assert.equal(rows.find((r) => r.name === 'Old Name').part, null);
  assert.equal(sameFirstName('Ella Brown', 'Ella B.'), true);
  assert.equal(sameFirstName('Noor Khan', 'Ella B.'), false);
});

const TOKEN = 'a'.repeat(64);
const pass = { limit: async () => ({ success: true }) };
function kv() {
  const m = new Map();
  return {
    m,
    getWithMetadata: async (k) => ({ metadata: m.get(k)?.metadata ?? null }),
    put: async (k, v, o = {}) => void m.set(k, { v, metadata: o.metadata }),
    delete: async (k) => void m.delete(k),
    list: async ({ prefix }) => ({ keys: [...m].filter(([k]) => k.startsWith(prefix)).map(([name, e]) => ({ name, metadata: e.metadata })), list_complete: true }),
  };
}
const worker = async () => ({ KV: kv(), LIMIT: pass, WRITES: pass, ORIGIN: 'https://x.dev', TOKEN_HASH: await tokenHash(TOKEN), STAFF_HASH: await tokenHash('staff') });
const send = (e, path, body, headers = { 'x-cast-token': TOKEN }) => handle(new Request(`https://w.dev${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }), e);
const ROW = { id: 'f'.repeat(32), pack: `p${'0'.repeat(32)}`, who: 'c2VhbGVk', percent: 10, learnt: 1, total: 10, fading: 0, lastDay: '2026-11-01' };

test('a row can be taken off by its phone or the director, and bad values are refused', async () => {
  const e = await worker();
  for (const bad of [{ who: null }, { lastDay: '9999-99-99' }, { who: 7 }]) assert.equal((await send(e, '/progress', { ...ROW, ...bad })).status, 400);
  assert.equal((await send(e, '/progress', { ...ROW, who: 'A'.repeat(252) })).status, 204, 'a name in any alphabet fits');
  const { who, ...old } = ROW;
  assert.equal((await send(e, '/progress', { ...old, id: 'e'.repeat(32) })).status, 204, 'a phone not yet updated');
  assert.equal((await send(e, '/progress/off', { id: ROW.id })).status, 204);
  assert.equal(e.KV.m.has(`prog:${ROW.id}`), false);
  assert.equal((await send(e, '/staff/remove', { id: 'e'.repeat(32) })).status, 401);
  assert.equal((await send(e, '/staff/remove', { id: 'e'.repeat(32) }, { 'x-staff-token': 'staff' })).status, 204);
  assert.equal(e.KV.m.size, 0);
});

test('after the show nothing is sent and what is left goes', async () => {
  const e = await worker();
  await send(e, '/progress', ROW);
  await e.KV.put('sub:x', '{}', { metadata: { nextAt: 0 } });
  e.CLOSED = '1';
  assert.equal((await send(e, '/progress', ROW)).status, 410);
  assert.equal(await tick(e, Date.UTC(2026, 10, 4, 17), () => assert.fail('no push')), 0);
  assert.equal(e.KV.m.size, 0);
});

test('a big part starts on long rounds, a small one on normal rounds', () => {
  assert.equal(roundMinutes(60), 5);
  assert.equal(roundMinutes(61), 8);
});

test('with lines still to learn, the next reminder comes later the same day, and never late at night', () => {
  const app = fakeApp();
  const at = (hour) => new Date(2026, 10, 2, hour, 0).getTime();
  const args = (now) => ({ model: app.model, getState: app.getState, now });
  assert.equal(nextNudge(args(at(16))), at(19));
  assert.ok(nextNudge(args(at(18))) > at(24), 'too late tonight: tomorrow');
  learn(app, app.model.items.map((it) => it.id), { proved: true });
  assert.ok(nextNudge(args(at(16))) >= at(16) + 20 * 3600000, 'every line learnt: a day apart');
});

test('a phone sends each scene short, and the director reads it back', () => {
  const app = fakeApp();
  const text = sceneLine(app.model, app.getState);
  assert.match(text, /^[^|=]+=\d+(\|[^|=]+=\d+)*$/);
  assert.deepEqual(sceneList('1=40|Prologue=100'), [{ label: 'Scene 1', percent: 40 }, { label: 'Prologue', percent: 100 }]);
  assert.deepEqual(sceneList(undefined), []);
  assert.deepEqual(sceneAverages([{ scenes: '1=40|2=100' }, { scenes: '1=60' }, {}]), [{ label: 'Scene 1', percent: 50, pupils: 2 }, { label: 'Scene 2', percent: 100, pupils: 1 }]);
});

test('the chase list says who and why, and keeps parts with no one on them in one line', () => {
  const rows = [
    { name: 'Keeper' },
    { name: 'Ann', percent: 0, lastDay: null, fading: 0 },
    { name: 'Ben', percent: 40, lastDay: '2026-10-28', fading: 0 },
    { name: 'Cal', percent: 60, lastDay: '2026-10-31', fading: 6 },
    { name: 'Dee', percent: 80, lastDay: '2026-10-31', fading: 1 },
  ];
  assert.deepEqual(chaseList(rows, '2026-10-31'), {
    waiting: ['Keeper'],
    chase: [
      { name: 'Ann', why: 'Opened the app, no practice yet.' },
      { name: 'Ben', why: 'No practice for 3 days.' },
      { name: 'Cal', why: '6 lines fading.' },
    ],
  });
});

test('the install steps follow where each Safari keeps Share', () => {
  const ua = (v) => `Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) Version/${v} Mobile/15E148 Safari/604.1`;
  assert.equal(safariMenu(ua('27.1')), 'lines');
  assert.equal(safariMenu(ua('26.0')), 'dots');
  assert.equal(safariMenu(ua('17.5')), 'share');
  assert.equal(safariMenu('nothing to go on'), 'share');
});
