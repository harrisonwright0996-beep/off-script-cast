import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeApp, fixtureModel, learn } from './helpers.mjs';
import { indexModel } from '../src/items.js';
import { memberModel } from '../src/cast/subset.js';
import { cleanCode, deriveKeys, seal, unseal, tokenHash } from '../src/cast/pack.js';
import { crossed, earnsProof, fadingCount, gainLine, isLearnt, learntPercent, needsProof, sceneLights, spotCheck } from '../src/cast/proof.js';
import { newState, applyKnown, applyResult, knownToday } from '../src/state.js';
import { detect, mustInstall } from '../src/device.js';
import { nextNudge, nudgeText, nudgeWhy } from '../src/cast/reminders.js';
import { SCIENCE } from '../src/cast/science.js';
import { ENDS } from '../src/cast/config.js';
import { isFourWords, tidyCode } from '../src/ui/unlock.js';
import { memberPack } from '../src/cast/build.js';
import { unzipSync, strFromU8 } from '../vendor/fflate.js';
import { makeCode } from '../tools/make-packs.mjs';
import { HOUR } from '../src/memory.js';

const { model } = fixtureModel();
const speakers = [...new Set(model.items.map((it) => it.speaker))];
const one = speakers[0];
const ids = model.items.filter((it) => it.speaker === one).map((it) => it.id);

test('a member keeps only their lines, each at its place in the play', () => {
  const m = memberModel(model, ids, { self: one });
  assert.deepEqual(m.items.map((it) => it.id), ids);
  for (const it of m.items) assert.equal(it.index, model.items.find((x) => x.id === it.id).index);
  assert.equal(m.totals.items, ids.length);
  assert.equal(m.totals.words, m.items.reduce((n, it) => n + it.words, 0));
  assert.equal(m.scenes.length, model.scenes.length);
});

test('nothing of another part is in a member model except the cues', () => {
  const m = memberModel(model, ids, { self: one });
  const others = model.items.filter((it) => !ids.includes(it.id));
  const text = JSON.stringify({ items: m.items.map((it) => it.text), reader: m.scenes.map((s) => s.reader) });
  for (const it of others) assert.ok(!text.includes(it.text), 'a line that is not theirs');
});

test('every line of a member keeps its cue from the whole play', () => {
  const m = memberModel(model, ids, { self: one });
  for (const it of m.items) assert.deepEqual(it.cue, model.items.find((x) => x.id === it.id).cue);
});

test('every item is in one beat of its own scene, and beats have ids the index finds', () => {
  const m = memberModel(model, ids, { self: one });
  const index = indexModel(m);
  for (const it of m.items) {
    const beat = index.beatById.get(it.beat);
    assert.ok(beat.itemIds.includes(it.id));
    assert.equal(beat.scene, it.scene);
  }
});

test('own lines do not name the speaker; another character does', () => {
  const two = speakers[1];
  const both = model.items.filter((it) => it.speaker === one || it.speaker === two).map((it) => it.id);
  const m = memberModel(model, both, { self: one });
  assert.ok(m.items.filter((it) => it.speaker === one).every((it) => !it.askSpeaker));
  assert.ok(m.items.some((it) => it.speaker === two && it.askSpeaker));
});

test('longer cues saved with the model are the ones the index uses', () => {
  const m = memberModel(model, model.items.map((it) => it.id));
  const whole = indexModel(model).cues;
  assert.equal(indexModel(m).cues.size, whole.size);
});

test('the code ignores case and spacing, and opens what it sealed', async () => {
  assert.equal(cleanCode('  Otter LAMP-river   nine '), 'otter lamp river nine');
  const a = await deriveKeys('Otter lamp river nine', 1000);
  const b = await deriveKeys('otter-lamp-river-nine', 1000);
  assert.deepEqual(a, b);
  const sealed = await seal(a.key, new TextEncoder().encode('hello'));
  assert.equal(new TextDecoder().decode(await unseal(b.key, sealed)), 'hello');
});

test('a wrong code does not open a pack, and key and token are different', async () => {
  const a = await deriveKeys('otter lamp river nine', 1000);
  const c = await deriveKeys('otter lamp river ten', 1000);
  assert.notEqual(a.key, a.token);
  await assert.rejects(unseal(c.key, await seal(a.key, new Uint8Array([1, 2, 3]))));
  assert.match(await tokenHash(a.token), /^[0-9a-f]{64}$/);
});

test('only typed, from the cue alone, off the ladder, earns proof', () => {
  assert.equal(earnsProof({ pass: true, mode: 'type' }), true);
  assert.equal(earnsProof({ pass: true, mode: 'say' }), false);
  assert.equal(earnsProof({ pass: true, mode: 'walk' }), false);
  assert.equal(earnsProof({ pass: false, mode: 'type' }), false);
  assert.equal(earnsProof({ pass: true, mode: 'type', help: true }), false);
  assert.equal(earnsProof({ pass: true, mode: 'type', ladder: true }), false);
  assert.equal(earnsProof({ pass: true, mode: 'type', slip: true }), false, 'a slip of the finger counted right proves nothing');
});

test('a proof stays through right answers, a line said right twice still needs one, and any miss loses it', () => {
  const day = '2026-10-30';
  const tomorrow = '2026-10-31';
  let s = applyResult(newState('x'), { pass: true, day, time: 1, mode: 'say' });
  assert.equal(needsProof(s, day), false, 'not the day it was first met');
  assert.equal(needsProof(s, tomorrow), true);
  s = applyResult(s, { pass: true, day, time: 2, mode: 'say' });
  assert.equal(s.status, 'review');
  assert.equal(isLearnt(s), false);
  s = applyResult(s, { pass: true, day, time: 3, mode: 'type', proof: true });
  assert.equal(isLearnt(s), true);
  s = applyResult(s, { pass: true, day, time: 4, mode: 'say' });
  assert.equal(s.proved, true);
  for (const mode of ['type', 'say', 'walk']) {
    const missed = applyResult(s, { pass: false, day, time: 5, mode });
    assert.equal(missed.proved, false, `a miss by ${mode}`);
    assert.equal(needsProof(missed, day), false, 'not the day it was missed');
    assert.equal(needsProof(missed, tomorrow), true, 'so the next day the go from the cue is typed');
    const said = applyResult(missed, { pass: true, day, time: 6, mode: 'say' });
    assert.equal(isLearnt(said), false, 'and saying it does not win it back');
    assert.equal(isLearnt(applyResult(missed, { pass: true, day, time: 6, mode: 'walk' })), false, 'nor does a walk');
    assert.equal(isLearnt(applyResult(said, { pass: true, day, time: 7, mode: 'type', proof: true })), true, 'typing it does');
  }
});

test('spot checks fall on about a third of learned lines, and never on a new one', () => {
  const s = { ...newState('x'), status: 'review', passes: 3, proved: true };
  let hits = 0;
  for (let goes = 0; goes < 3000; goes++) if (spotCheck(s, goes, 'x')) hits += 1;
  assert.ok(hits > 850 && hits < 1150, String(hits));
  assert.equal(spotCheck(newState('x'), 1, 'x'), false);
});

test('% learnt is by words, rounded down, and a scene light is its own share', () => {
  const app = fakeApp();
  const all = app.model.items;
  assert.equal(learntPercent(app.model, app.getState), 0);
  learn(app, all.map((it) => it.id), { proved: true });
  assert.equal(learntPercent(app.model, app.getState), 100);
  learn(app, [all[0].id], { proved: false });
  assert.ok(learntPercent(app.model, app.getState) < 100);
  assert.ok(sceneLights(app.model, app.getState).every((l) => l.percent <= 100));
});

test('fading counts learnt lines ready to check; a missed line is not fading', () => {
  const app = fakeApp();
  const [a, b] = app.model.items;
  learn(app, [a.id], { proved: true });
  learn(app, [b.id], { proved: true, lastResult: 'miss' });
  assert.equal(fadingCount(new Map([[a.id, 0.8], [b.id, 0]]), app.getState), 1);
});

test('crossing a milestone says which, the highest one first', () => {
  assert.equal(crossed(20, 30), 25);
  assert.equal(crossed(20, 80), 75);
  assert.equal(crossed(26, 30), null);
  assert.equal(crossed(99, 100), 100);
});

test('every device gets the right steps', () => {
  const ua = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
    insta: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0',
    tiktok: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 musical_ly_36',
    webview: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36',
    android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
    samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36',
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  };
  assert.equal(detect({ ua: ua.iphone }), 'ios-safari');
  assert.equal(detect({ ua: ua.chromeIos }), 'ios-other');
  assert.equal(detect({ ua: ua.insta }), 'in-app');
  assert.equal(detect({ ua: ua.tiktok }), 'in-app');
  assert.equal(detect({ ua: ua.webview }), 'in-app');
  assert.equal(detect({ ua: ua.android }), 'android-chrome');
  assert.equal(detect({ ua: ua.samsung }), 'android-other');
  assert.equal(detect({ ua: ua.mac, platform: 'MacIntel', touch: 0 }), 'desktop');
  assert.equal(detect({ ua: ua.mac, platform: 'MacIntel', touch: 5 }), 'ios-safari'); // an iPad asks for desktop sites
  assert.equal(detect({ ua: ua.iphone, standalone: true }), 'standalone');
  assert.equal(mustInstall('ios-safari'), true);
  assert.equal(mustInstall('desktop'), false);
  assert.equal(mustInstall('standalone'), false);
});

test('an app showing the page inside itself is told apart from a browser, on iPhone and Android', () => {
  const webkit = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
  const android = 'Mozilla/5.0 (Linux; Android 14; 2201116SG) AppleWebKit/537.36 (KHTML, like Gecko)';
  const table = [
    [`${webkit} Version/18.5 Mobile/15E148 Safari/604.1`, 'ios-safari'],
    [`${webkit} Mobile/15E148`, 'in-app'], // no Safari/: an app we have not named
    [`${webkit} Mobile/15E148 Snapchat/13.0`, 'in-app'],
    [`${webkit} CriOS/130.0.0.0 Mobile/15E148 Safari/604.1`, 'ios-other'],
    [`${webkit} FxiOS/130.0 Mobile/15E148 Safari/605.1.15`, 'ios-other'],
    [`${webkit} Version/18.5 EdgiOS/130.0.0.0 Mobile/15E148 Safari/604.1`, 'ios-other'],
    [`${webkit} Version/18.5 Mobile/15E148 DuckDuckGo/7 Safari/605.1.15`, 'ios-other'],
    [`${android} Chrome/130.0.0.0 Mobile Safari/537.36`, 'android-chrome'],
    [`${android} Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 XiaoMi/MiuiBrowser/14.7.0`, 'android-other'],
    [`${android} Chrome/120.0.0.0 HuaweiBrowser/14.0.0.320 Mobile Safari/537.36`, 'android-other'],
    [`${android} SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36`, 'android-other'],
    [`${android} Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0`, 'android-other'],
    [`${android} Chrome/130.0.0.0 Mobile Safari/537.36 OPR/85.0.0.0`, 'android-other'],
    [`${android} HeyTapBrowser/45.10 Chrome/120.0.0.0 Mobile Safari/537.36`, 'android-other'],
    ['Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0', 'android-other'],
    [`Mozilla/5.0 (Linux; Android 14; 2201116SG; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36`, 'in-app'],
  ];
  for (const [ua, kind] of table) assert.equal(detect({ ua }), kind, ua);
});

test('a code pasted from a message is tidied, and anything but four words is caught', () => {
  assert.equal(tidyCode('  Code: "Otter lamp river nine"  '), 'Otter lamp river nine');
  assert.equal(tidyCode('"Code: otter lamp river nine"'), 'otter lamp river nine');
  assert.equal(tidyCode('code:otter lamp river nine'), 'otter lamp river nine');
  assert.equal(tidyCode('“otter lamp river nine”'), 'otter lamp river nine');
  assert.equal(tidyCode('otter lamp river nine'), 'otter lamp river nine');
  for (const code of ['otter lamp river nine', 'otter-lamp-river-nine', 'Code: otter lamp river nine', "'OTTER  lamp river nine.'"]) assert.equal(isFourWords(code), true, code);
  for (const code of ['', 'otter', 'otter lamp river', 'otter lamp river nine ten', 'Code:']) assert.equal(isFourWords(code), false, code);
});

test('the end of the show is a real day, in the form today is compared with', () => {
  assert.match(ENDS, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok('2027-01-31' <= ENDS && '2027-02-01' > ENDS);
});

test('a line already known needs no teaching, but is not learnt until typed right on a later day', () => {
  const s = applyKnown(newState('x'), { day: '2026-11-02', time: 1000 });
  assert.equal(s.status, 'review');
  assert.equal(s.lastResult, 'pass');
  assert.equal(s.proved, false);
  assert.equal(isLearnt(s), false);
  assert.equal(knownToday(s, '2026-11-02'), true);
  assert.equal(knownToday(s, '2026-11-01'), true, 'the clock put back does not help');
  assert.equal(knownToday(s, '2026-11-03'), false);
  assert.equal(needsProof(s, '2026-11-02'), false, 'not the same day');
  assert.equal(needsProof(s, '2026-11-03'), true, 'on another day');
  assert.equal(isLearnt(applyResult(s, { pass: true, day: '2026-11-03', time: 2000, mode: 'type', proof: true })), true);
});

test('the end of a round says what it gained: the rise in %, or else the lines on their way', () => {
  assert.equal(gainLine(24, 28, 6), 'Up to 28%.');
  assert.match(gainLine(0, 0, 6), /^6 lines on their way\. They count/);
  assert.match(gainLine(0, 0, 1), /^1 line on its way\. It counts/);
  assert.match(gainLine(30, 28, 2), /^2 lines on their way/, 'never a telling off, even after a drop');
  assert.equal(gainLine(30, 30, 0), null);
});

test('fading counts lines the curve says are going, not lines ready only because of the date', () => {
  const app = fakeApp({ settings: { proofs: true } });
  const ids = app.model.items.map((it) => it.id);
  learn(app, ids, { proved: true, stability: 500, hoursAgo: 48 });
  const before = app.plan();
  assert.equal(fadingCount(before.ready, app.getState), 0);
  app.setDay('2026-11-03'); // a final day: every line is ready today
  learn(app, ids, { proved: true, stability: 500, hoursAgo: 24 });
  const after = app.plan();
  assert.equal(after.ready.size, ids.length);
  assert.equal(fadingCount(after.ready, app.getState), 0, 'nothing has changed for them');
  learn(app, ids.slice(0, 3), { proved: true, stability: 1, hoursAgo: 24 });
  assert.equal(fadingCount(app.plan().ready, app.getState), 3);
});

test('the next nudge is never within 20 hours, never past a week, and falls in the afternoon for new lines', () => {
  const now = new Date(2026, 10, 2, 18, 0).getTime();
  const app = fakeApp();
  const none = nextNudge({ model: app.model, getState: app.getState, now });
  assert.equal(new Date(none).getHours(), 16);
  assert.ok(none >= now + 20 * HOUR);
  learn(app, app.model.items.map((it) => it.id), { proved: true });
  const all = nextNudge({ model: app.model, getState: app.getState, now });
  assert.ok(all >= now + 20 * HOUR && all <= now + 7 * 24 * HOUR);
});

test('a nudge says keep them once every line is learnt, and never names a person or a line', () => {
  assert.match(nudgeText({ percent: 100, turn: 0 }).body, /keeps them fresh/);
  assert.notEqual(nudgeText({ percent: 40, turn: 0 }).body, nudgeText({ percent: 40, turn: 1 }).body);
  const body = [0, 1, 2, 3].flatMap((turn) => [40, 100].map((percent) => nudgeText({ percent, turn }).body)).join(' ');
  assert.ok(!/\d+ ?%|deadline|by \w+day/i.test(body));
});

test('the words fit why the nudge comes: new lines with nothing fading never say lines are slipping', () => {
  const now = new Date(2026, 10, 2, 18, 0).getTime();
  const app = fakeApp();
  const args = () => ({ model: app.model, getState: app.getState, now });
  assert.equal(nudgeWhy(args()), 'new'); // nothing learnt yet, so nothing can fade
  for (const turn of [0, 1, 2, 3]) assert.equal(nudgeText({ percent: 0, turn, why: 'new' }).body, 'Your lines are ready when you are. Fancy a quick round?');
  learn(app, app.model.items.map((it) => it.id), { proved: true });
  assert.equal(nudgeWhy(args()), 'fading'); // every line learnt: only fading is left to bring them back
  assert.match(nudgeText({ percent: 100, turn: 0, why: 'fading' }).body, /keeps them fresh/);
  const fading = [0, 1, 2, 3].map((turn) => nudgeText({ percent: 40, turn, why: 'fading' }).body);
  assert.ok(fading.includes('One quick round now does more than a long one later.'));
  assert.ok(fading.includes('Lines you have started are slipping a little. Catch them now and they last longer.'));
});

test('the notes on how it works make no promise and use no dashes', () => {
  assert.ok(SCIENCE.includes('Hard does not mean it is going badly. Digging for a line, then checking it, helps it stick.'));
  assert.ok(SCIENCE.some((s) => s.endsWith('not from your last line. On stage, the cue is all you get.')));
  assert.ok(!SCIENCE.join(' ').includes('\u2014'));
});

test('a pack opens with only that member, and every clip its manifest names', () => {
  const clip = (file) => ({ file, duration: 1 });
  const items = Object.fromEntries(model.items.map((it, i) => [it.id, { line: clip(`l${i}`), cue: clip(`c${i}`) }]));
  const manifest = { sampleRate: 22050, bitrate: 32, made: 'test', silence: clip('s'), items, speakers: {}, headings: {} };
  const clips = new Map(Object.values(items).flatMap((x) => [x.line, x.cue]).map((c) => [c.file, new Uint8Array([1])]));
  clips.set('s', new Uint8Array([1]));
  clips.set('coach', new Uint8Array([1]));
  const member = { name: one, ids };
  const { sub, zip } = memberPack(model, member, { manifest, clips }, { coach: { listen: clip('coach') } });
  const files = unzipSync(zip);
  const inside = JSON.parse(strFromU8(files['manifest.json']));
  assert.deepEqual(Object.keys(inside.items).sort(), [...ids].sort());
  assert.equal(JSON.parse(strFromU8(files['model.json'])).items.length, sub.items.length);
  for (const it of Object.values(inside.items)) assert.ok(files[it.line.file] && files[it.cue.file]);
  assert.ok(files.coach && files.s);
  const others = model.items.filter((it) => !ids.includes(it.id)).map((it) => `l${model.items.indexOf(it)}`);
  for (const f of others) assert.equal(files[f], undefined, 'a clip that is not theirs');
});

test('the company code is four words', () => {
  let n = 0;
  const code = makeCode((max) => (n++ * 37) % max);
  assert.equal(code.split(' ').length, 4);
  assert.equal(cleanCode(code), cleanCode(code.toUpperCase().replace(/ /g, '  ')));
});

test('placards and on screen words are never taught, checked or counted, for anyone', () => {
  const { model: whole } = fixtureModel();
  const unspoken = whole.scenes.flatMap((sc) => sc.reader).filter((r) => r.t === 'placard' || r.t === 'screen').map((r) => r.text);
  assert.ok(unspoken.length >= 2, 'the invented play has both');
  const m = memberModel(whole, whole.items.map((it) => it.id), { self: null });
  for (const text of unspoken) assert.ok(!m.items.some((it) => it.text.includes(text)), 'taught as a line');
  assert.equal(m.totals.words, m.items.reduce((n, it) => n + it.words, 0));
});
