import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBackup, readBackup, BackupError } from '../src/backup.js';
import { fakeApp, learn } from './helpers.mjs';
import { learntPercent } from '../src/cast/proof.js';
import { applyHelp, newState } from '../src/state.js';

test('a backup holds ids and results only, and restores onto the same script', () => {
  const app = fakeApp();
  const ids = app.model.scenes[1].itemIds;
  learn(app, ids, { stability: 5 });
  const prev = { ...app.getState(ids[0]), passDays: ['x'], missDays: [] };
  app.events.push({ key: 7, time: 1, day: '2026-10-26', id: ids[0], pass: true, mode: 'type', queue: 'due', prev });
  const data = makeBackup({ model: app.model, states: app.states.values(), events: app.events, settings: app.settings, now: 42 });
  const text = JSON.stringify(data);
  for (const it of app.model.items) assert.ok(!text.includes(it.text), 'no line text in a backup');
  assert.deepEqual(data.events[0].prev, { status: 'review', stability: 5, lastTime: prev.lastTime });
  assert.equal('key' in data.events[0], false);
  const back = readBackup(text, app.model);
  assert.deepEqual([back.kept, back.dropped, back.sameScript, back.made], [ids.length, 0, true, 42]);
  assert.deepEqual(back.states.find((s) => s.id === ids[2]), app.getState(ids[2]));
  assert.equal(back.events.length, 1);
  assert.equal(back.settings.deadline, '2026-11-04');
});

test('a backup from another version of the script keeps the lines still in it', () => {
  const app = fakeApp();
  learn(app, app.model.scenes[0].itemIds);
  const data = makeBackup({ model: app.model, states: [...app.states.values(), { id: 'gone', status: 'review' }], events: [], settings: app.settings });
  data.scriptHash = 'other';
  const back = readBackup(JSON.stringify(data), app.model);
  assert.deepEqual([back.kept, back.dropped, back.sameScript], [4, 1, false]);
});

const backupOf = (app, states, extra = {}) => JSON.stringify({ ...makeBackup({ model: app.model, states, events: [], settings: app.settings, now: 42 }), ...extra });

test('every line comes back unproved, so the % is earned again by typing', () => {
  const app = fakeApp();
  const ids = app.model.items.map((it) => it.id);
  learn(app, ids, { proved: true, stability: 9999 });
  const back = readBackup(backupOf(app, app.states.values()), app.model);
  assert.equal(back.kept, ids.length);
  assert.ok(back.states.every((s) => s.proved === false));
  const restored = new Map(back.states.map((s) => [s.id, s]));
  assert.equal(learntPercent(app.model, (id) => restored.get(id)), 0);
});

test('a state the app could not work with is dropped, and so is anything it does not know', () => {
  const app = fakeApp();
  const ids = app.model.items.map((it) => it.id);
  learn(app, ids.slice(0, 2));
  const good = app.getState(ids[0]);
  const bad = [
    { id: ids[2] }, // no status, no last day: this one stopped the app opening
    { ...good, id: ids[3], lastDay: undefined },
    { ...good, id: ids[4], stability: 'banana' },
    { ...good, id: ids[5], stability: -1 },
    { ...good, id: ids[6], lastTime: 'x' },
    { ...good, id: ids[7], status: 'perfect' },
    { ...good, id: ids[8], passes: 2.5 },
    { ...good, id: ids[9], passDays: 'always' },
    { ...good, id: ids[10], learnedDay: null },
    { ...good, id: ids[11], firstDay: 7 },
    null,
    'x',
    { ...good, id: ids[0], passes: 99 }, // the same line twice
  ];
  const data = JSON.parse(backupOf(app, [...app.states.values(), ...bad]));
  data.states[0].cheat = true;
  data.events = [{ id: ids[0] }, { id: ids[0], time: 1, day: '2026-10-26', pass: true, mode: 'type', prev: { status: 'review', stability: 'x' } }, { id: ids[2], time: 1, day: '2026-10-26', pass: true, mode: 'type', prev: null }, { id: ids[0], time: 1, day: '2026-10-26', pass: true, mode: 'type', prev: null }];
  const back = readBackup(JSON.stringify(data), app.model);
  assert.deepEqual(back.states.map((s) => s.id), ids.slice(0, 2));
  assert.equal(back.dropped, bad.length);
  assert.equal('cheat' in back.states[0], false);
  assert.equal(back.events.length, 1, 'only a good event of a line kept');
});

test('a line right only with the first letters has no last day yet, and is kept', () => {
  const app = fakeApp();
  const id = app.model.items[0].id;
  const s = applyHelp(newState(id), { day: '2026-10-26' });
  assert.equal(readBackup(backupOf(app, [s]), app.model).kept, 1);
});

test('settings of the wrong kind or out of range are left out', () => {
  const app = fakeApp();
  learn(app, [app.model.items[0].id]);
  const settings = { ...app.settings, sprintMinutes: 0, textSize: 'big', theme: 7, deadline: 'soon', walkGap: 'x', proofs: false, unknown: 1 };
  const back = readBackup(backupOf(app, app.states.values(), { settings }), app.model);
  for (const key of ['sprintMinutes', 'textSize', 'theme', 'deadline', 'walkGap', 'proofs', 'unknown']) assert.equal(key in back.settings, false, key);
  assert.equal(back.settings.mode, 'type');
});

test('another member\'s file is refused, and so is a file with no line to keep', () => {
  const app = fakeApp();
  learn(app, [app.model.items[0].id]);
  const mine = makeBackup({ model: app.model, states: app.states.values(), events: [], settings: app.settings, member: 'Alex' });
  assert.equal(mine.member, 'Alex');
  const text = JSON.stringify(mine);
  assert.equal(readBackup(text, app.model, 'Alex').kept, 1);
  const code = (fn) => {
    try {
      fn();
    } catch (e) {
      return e.code;
    }
  };
  assert.equal(code(() => readBackup(text, app.model, 'Sam')), 'other-member');
  assert.equal(code(() => readBackup(backupOf(app, app.states.values()), app.model, 'Sam')), 'other-member', 'a file with no name on it could be anyone\'s');
  assert.equal(code(() => readBackup(backupOf(app, [{ id: 'gone', status: 'review' }]), app.model)), 'no-lines');
  assert.equal(code(() => readBackup(backupOf(app, []), app.model)), 'no-lines');
});

test('files that are not backups are refused plainly', () => {
  const app = fakeApp();
  const code = (text) => {
    try {
      readBackup(text, app.model);
    } catch (e) {
      assert.ok(e instanceof BackupError);
      return e.code;
    }
  };
  assert.equal(code('not json'), 'not-json');
  assert.equal(code('{"app":"other"}'), 'not-backup');
  assert.equal(code('{"app":"off-script-cast","version":9,"states":[],"events":[]}'), 'newer');
  assert.equal(code('{"app":"off-script-cast","made":1,"states":[],"events":[]}'), 'not-backup', 'no version');
  assert.equal(code('{"app":"off-script-cast","version":1,"states":[],"events":[]}'), 'not-backup', 'no date');
});
