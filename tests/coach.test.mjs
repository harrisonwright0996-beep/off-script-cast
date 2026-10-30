import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeApp, fixtureModel } from './helpers.mjs';
import { buildWalk, noteKey, partAt } from '../src/tape.js';
import { COACH, STEPS } from '../src/coach.js';
import { memberModel } from '../src/cast/subset.js';
import { indexModel } from '../src/items.js';

const clipRef = (file, duration = 1) => ({ file, duration });
function manifestOf(model, { coach = true } = {}) {
  const items = {};
  for (const it of model.items) items[it.id] = { line: clipRef(`l-${it.id}`), cue: it.cue.speaker === null ? null : clipRef(`c-${it.id}`) };
  const m = { silence: clipRef('s', 0.25), items, speakers: {}, headings: Object.fromEntries(model.scenes.map((s) => [s.index, clipRef(`h-${s.index}`)])) };
  for (const it of model.items) m.speakers[it.speaker] = clipRef(`p-${it.speaker}`);
  if (coach) {
    m.coach = Object.fromEntries(Object.keys(COACH).map((k) => [k, clipRef(`coach-${k}`)]));
    m.notes = Object.fromEntries(model.items.flatMap((it) => it.cue.notes.map((n) => [noteKey(n), clipRef(`n-${noteKey(n)}`)])));
  }
  return m;
}

function walk(app, manifest, seconds = 300) {
  const plan = app.plan();
  return buildWalk({ model: app.model, index: app.index, manifest, getState: app.getState, settings: app.settings, plan, start: app.clock, seconds });
}

const files = (tape) => tape.steps.filter((s) => s.clip).map((s) => s.clip);

test('a new line: listen, its line, say it back, once more, its line, say it back', () => {
  const app = fakeApp();
  const list = files(walk(app, manifestOf(app.model))).filter((f) => !f.startsWith('p-'));
  const first = list.indexOf('coach-listen');
  assert.equal(list[0], 'coach-intro');
  assert.ok(first >= 0);
  const line = list.slice(first).find((f) => f.startsWith('l-'));
  const at = list.indexOf(line, first);
  assert.deepEqual(list.slice(at, at + 4), [line, 'coach-sayBack', 'coach-again', line]);
  assert.equal(list[at + 4], 'coach-sayBack');
  assert.equal(list[list.length - 1], 'coach-end');
});

test('recall: your turn, a gap, here it is, the line; full words three times, then short', () => {
  const app = fakeApp();
  const tape = walk(app, manifestOf(app.model), 600);
  const list = files(tape);
  assert.equal(list.filter((f) => f === 'coach-turn').length, 3);
  assert.equal(list.filter((f) => f === 'coach-here').length, 3);
  assert.ok(list.filter((f) => f === 'coach-turnShort').length > 0);
  const i = tape.steps.findIndex((s) => s.clip === 'coach-turn');
  assert.ok(tape.steps[i + 1].silence > 0);
  assert.equal(tape.steps[i + 2].clip, 'coach-here');
});

test('the guide says what to do at every moment of the tape', () => {
  const app = fakeApp();
  const tape = walk(app, manifestOf(app.model));
  assert.equal(partAt(tape.guide, tape.guide[0].start), STEPS.listen);
  assert.ok(tape.guide.some((g) => g.label === STEPS.turn));
  for (let i = 1; i < tape.guide.length; i++) assert.ok(tape.guide[i].start >= tape.guide[i - 1].start);
});

test('a stage direction before a line is read with it, on teaching and its first run', () => {
  const app = fakeApp();
  const it = app.model.items.find((x) => x.cue.notes.length);
  assert.ok(it, 'the invented play has directions');
  const tape = walk(app, manifestOf(app.model), 3600);
  const note = `n-${noteKey(it.cue.notes[0])}`;
  const list = files(tape);
  const at = list.indexOf(note);
  assert.ok(at > 0);
  assert.equal(list[at - 1], 'coach-stage');
});

test('a pack with no coach makes the same tape as before', () => {
  const app = fakeApp();
  const list = files(walk(app, manifestOf(app.model, { coach: false })));
  assert.ok(list.every((f) => !f.startsWith('coach-')));
});

test('a line after someone else\'s always gets its cue, on a member\'s own tape', () => {
  const { model } = fixtureModel();
  const one = model.items[1].speaker;
  const ids = model.items.filter((it) => it.speaker === one).map((it) => it.id);
  const m = memberModel(model, ids, { self: one });
  const app = fakeApp();
  app.model = m;
  app.index = indexModel(m);
  const tape = walk(app, manifestOf(m), 900);
  const list = files(tape);
  for (let i = 1; i < m.items.length; i++) {
    const it = m.items[i];
    const adjacent = it.index === m.items[i - 1].index + 1;
    if (!adjacent && it.cue.speaker !== null && list.includes(`l-${it.id}`)) assert.ok(list.includes(`c-${it.id}`), 'cue played');
  }
});
