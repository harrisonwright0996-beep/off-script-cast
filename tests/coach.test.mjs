import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeApp, fixtureModel, learn } from './helpers.mjs';
import { buildWalk, JUDGE, markedLines, markTrial, noteKey, partAt, replayPoint, resumePoint, reviewRows, spokenRole, trialAt, walkRecords, walkResults } from '../src/tape.js';
import { COACH, COACH_SPEECH, STEPS } from '../src/coach.js';
import { memberModel } from '../src/cast/subset.js';
import { buildModel, indexModel } from '../src/items.js';
import { memberPack } from '../src/cast/build.js';
import { createPlayer } from '../src/player.js';
import { clipTexts, speechManifest } from '../src/ui/walk.js';
import { newState, needsTeaching } from '../src/state.js';
import { beatStage } from '../src/plan.js';
import { asRoles } from '../tools/make-packs.mjs';
import { unzipSync, strFromU8 } from '../vendor/fflate.js';

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

// A tape with each step's start time, and what is on the screen at a moment.
const timeline = (tape) => {
  let t = 0;
  return tape.steps.map((s) => ({ ...s, at: (t += s.dur) - s.dur }));
};
const clipAt = (tape, file, n = 0) => timeline(tape).filter((s) => s.clip === file)[n].at;

test('another character\'s line: the role is said before Your turn, and not after the gap; their own part has no role', () => {
  const { model } = fixtureModel();
  const [one, two] = [...new Set(model.items.map((it) => it.speaker))];
  const ids = model.items.filter((it) => it.speaker === one || it.speaker === two).map((it) => it.id);
  const m = memberModel(model, ids, { self: one });
  const index = indexModel(m);
  const app = fakeApp();
  const tape = buildWalk({ model: m, index, manifest: manifestOf(m), getState: app.getState, settings: app.settings, plan: { k: 1, newBeats: m.beats.map((b) => b.id), ahead: [] }, start: app.clock, seconds: 3600 });
  const asked = tape.trials.filter((tr) => index.byId.get(tr.id).askSpeaker);
  assert.ok(asked.length > 0);
  const timed = timeline(tape);
  for (const tr of asked) {
    const i = timed.findIndex((s) => s.at >= tr.start - 1e-9);
    assert.equal(timed[i - 1].clip, `p-${index.byId.get(tr.id).speaker}`, 'the role, just before Your turn');
    const after = timed.findIndex((s) => s.at >= tr.answerEnd - 1e-9);
    assert.equal(timed[after - 1].clip, `l-${tr.id}`);
    assert.ok(!(timed[after - 2].clip || '').startsWith('p-'), 'no role after the gap');
  }
  const own = tape.trials.find((tr) => index.byId.get(tr.id).speaker === one);
  const i = timed.findIndex((s) => s.at >= own.start - 1e-9);
  assert.ok(!(timed[i - 1].clip || '').startsWith('p-'));
  assert.equal(partAt(tape.guide, asked[0].start - 0.01), `Now you are ${index.byId.get(asked[0].id).speaker}`);
});

test('a line being taught: a mark counts against its first trial, and back goes to the start of its teaching', () => {
  const app = fakeApp();
  const tape = walk(app, manifestOf(app.model));
  const w = tape.teaching[1];
  assert.equal(tape.teaching.length, tape.heard.length);
  const first = tape.trials.findIndex((tr) => tr.id === w.id);
  assert.equal(trialAt(tape.trials, w.start + 3), -1, 'no answer yet');
  assert.equal(markTrial(tape, w.start + 3), first);
  assert.equal(tape.teaching[0].id, tape.trials[markTrial(tape, w.start + 1)].id, 'a tap just after a line is for that line');
  assert.equal(markTrial(tape, w.end - 0.1), first);
  assert.equal(replayPoint(tape, w.end - 0.1), w.start);
  assert.equal(markTrial(tape, 0.5), -1, 'the intro is not a line');
  assert.equal(replayPoint(tape, 0.5), null);
  const marked = new Set([first]);
  const rows = reviewRows(tape, marked, w.end); // the walk stopped before the line's first answer
  assert.deepEqual(rows.map((r) => [r.id, r.ticked]), [[w.id, true]]);
  const [result] = walkResults(tape, rows, marked);
  assert.equal(result.pass, false);
  const [rec] = walkRecords([result], { start: app.clock, getState: app.getState });
  assert.ok(needsTeaching(rec.state), 'it is taught again');
});

test('marks and the count agree: a mark in a gap is kept, a line marked twice is one line, and a doubt let go is not saved', () => {
  const tape = { trials: [{ id: 'a', queue: 'run', answerEnd: 5 }, { id: 'b', queue: 'run', answerEnd: 10 }, { id: 'a', queue: 'beat', answerEnd: 15 }] };
  const marked = new Set([0, 1, 2]);
  assert.equal(markedLines(tape, marked), 2);
  const rows = reviewRows(tape, marked, 6); // stopped in the second line's gap
  assert.deepEqual(rows.map((r) => [r.id, r.ticked]), [['a', true], ['b', true]]);
  assert.equal(rows.filter((r) => r.ticked).length, markedLines(tape, marked));
  rows[1].ticked = false; // not heard, and let go: nothing to say about it
  assert.deepEqual(walkResults(tape, rows, marked).map((r) => r.id), ['a', 'a']);
});

test('time to judge: a pause after each answer, and a tap once Your turn has begun is for the new line', () => {
  const app = fakeApp();
  const tape = walk(app, manifestOf(app.model), 900);
  const timed = timeline(tape);
  for (const tr of tape.trials) {
    const after = timed.find((s) => s.at >= tr.answerEnd - 1e-9);
    assert.ok(after.silence && after.dur >= JUDGE, 'a pause after the answer');
  }
  tape.trials.forEach((tr, i) => {
    const next = tape.trials[i + 1];
    if (!next) return;
    assert.ok(tr.end <= next.start);
    assert.equal(trialAt(tape.trials, tr.answerEnd + JUDGE - 0.1), i, 'a tap in the pause marks the answer');
    assert.equal(trialAt(tape.trials, next.start + 0.01), i + 1);
  });
});

test('the words and the screen move together', () => {
  const app = fakeApp();
  const it = app.model.items.find((x) => x.cue.notes.length);
  const tape = walk(app, manifestOf(app.model), 3600);
  const on = (t) => partAt(tape.guide, t);
  assert.equal(on(clipAt(tape, 'coach-run')), STEPS.run);
  assert.equal(on(clipAt(tape, 'coach-end')), STEPS.end);
  const timed = timeline(tape);
  // A check's next cue is under Listen for your cue, not the check before it.
  const cues = tape.trials.slice(1).map((tr) => timed.find((s) => s.clip === `c-${tr.id}` && s.at >= tr.replayFrom - 1e-9 && s.at < tr.start));
  assert.ok(cues.some(Boolean));
  for (const cue of cues.filter(Boolean)) assert.equal(on(cue.at), STEPS.cue);
  // The line after a stage direction is heard under Just listen, not Stage direction.
  const note = clipAt(tape, `n-${noteKey(it.cue.notes[0])}`);
  assert.equal(on(note), STEPS.stage);
  const line = timed.find((s) => s.clip === `l-${it.id}` && s.at > note);
  assert.notEqual(on(line.at), STEPS.stage);
});

test('Now run those lines is said only when lines were just taught', () => {
  const count = (tape) => files(tape).filter((f) => f === 'coach-run').length;
  const app = fakeApp();
  assert.ok(count(walk(app, manifestOf(app.model), 300)) > 0);
  // Every line right once: nothing to teach, so the beats are only run.
  const again = fakeApp();
  for (const id of again.model.items.map((x) => x.id)) again.states.set(id, { ...newState(id), status: 'learning', firstDay: again.today, passes: 1, passDays: [again.today], stability: 1, lastResult: 'pass', lastDay: again.today, lastTime: again.clock - 6 * 60000 });
  const tape = walk(again, manifestOf(again.model), 300);
  assert.equal(tape.heard.length, 0);
  assert.ok(tape.trials.length > 0);
  assert.equal(count(tape), 0);
});

test('resume: from the line\'s cue, from the start of a line being taught, or on from where it was', () => {
  const app = fakeApp();
  learn(app, app.model.beats[0].itemIds, { stability: 24, hoursAgo: 48 });
  const tape = walk(app, manifestOf(app.model), 900);
  const tr = tape.trials[2];
  assert.equal(resumePoint(tape, tr.start + 0.5), tr.replayFrom, 'in the gap: back to its cue');
  assert.equal(resumePoint(tape, tr.answerEnd + 0.1), null, 'after the answer: nothing to go back for');
  const w = tape.teaching[0];
  assert.equal(resumePoint(tape, w.end - 0.1), w.start);
  assert.equal(resumePoint(tape, 0.5), null, 'the intro just carries on');
});

test('the player resumes from where it is told, after a pause, and not after the tape ends or at the start', async () => {
  class FakeAudio extends EventTarget {
    currentTime = 0;
    paused = true;
    ended = false;
    play() {
      this.paused = false;
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
      this.dispatchEvent(new Event('pause'));
    }
  }
  const real = globalThis.Audio;
  globalThis.Audio = FakeAudio;
  try {
    const asked = [];
    const player = createPlayer({ resumeFrom: (t) => (asked.push(t), t > 10 ? 7 : null) });
    await player.play();
    assert.deepEqual(asked, [], 'the first play is not a resume');
    player.audio.currentTime = 12;
    player.pause();
    await player.play();
    assert.equal(player.time, 7);
    player.audio.currentTime = 3;
    player.pause();
    await player.play();
    assert.equal(player.time, 3, 'nowhere to go back to: it carries on');
    assert.deepEqual(asked, [12, 3]);
    player.audio.ended = true;
    player.pause();
    await player.play();
    assert.equal(asked.length, 2);
  } finally {
    globalThis.Audio = real;
  }
});

test('a walk proves nothing: lines only left as all good stay being taught, and a round still teaches them', () => {
  const app = fakeApp();
  const manifest = manifestOf(app.model);
  const tape = walk(app, manifest, 3600);
  const records = walkRecords(walkResults(tape, reviewRows(tape, new Set()), new Set()), { start: app.clock, getState: app.getState });
  records.forEach((rec) => app.save(rec));
  const taught = tape.heard.map((x) => x.id);
  assert.ok(taught.length > 0);
  for (const id of taught) {
    const s = app.getState(id);
    assert.equal(s.status, 'learning');
    assert.ok(needsTeaching(s));
    assert.equal(s.proved, false);
    assert.ok(s.walks >= 2, 'its two runs at least');
  }
  assert.ok(app.model.beats.filter((b) => b.itemIds.some((id) => taught.includes(id))).every((b) => beatStage(b, app.getState) === 'learn'));
  assert.ok(records.every((rec) => rec.event.mode === 'walk'), 'the practice is still in the record');
  const next = walk(app, manifest, 3600);
  assert.equal(next.heard.some((x) => taught.includes(x.id)), false, 'taught once: the next walk does not start them again');
  assert.ok(next.trials.length > 0);
});

test('a walk pass changes nothing that counts, typed or not; a mark brings the line back sooner and costs no %', () => {
  const day = '2026-10-26';
  const time = new Date(`${day}T12:00:00`).getTime();
  const base = { ...newState('a'), status: 'learning', firstDay: day, passes: 1, passDays: [day], stability: 1, lastResult: 'pass', lastDay: day, lastTime: time - 3600000 };
  const go = (state, pass = true) => walkRecords([{ trial: 0, id: 'a', queue: 'due', pass, at: 0 }], { start: time, getState: () => state })[0].state;
  const held = go(base);
  assert.equal(held.status, 'learning');
  assert.equal(held.passes, 1);
  assert.equal(held.walks, 1);
  assert.equal(go({ ...base, proved: true }).status, 'learning');
  const known = { ...base, status: 'review', learnedDay: day, passes: 4, stability: 24, proved: true, lastTime: time - 1000 };
  const walked = go(known);
  assert.deepEqual([walked.passes, walked.stability, walked.lastTime, walked.lastDay], [4, 24, known.lastTime, known.lastDay]);
  const marked = go(known, false);
  assert.deepEqual([marked.misses, marked.proved, marked.lastResult], [1, true, 'pass']);
  assert.ok(marked.stability < 24);
  assert.equal(go(base, false).misses, 1);
  assert.equal(go(base, false).lastResult, 'miss', 'not yet typed right: relearned as usual');
});

test('a role played as someone else is spoken in full, and only such roles are made', () => {
  assert.equal(spokenRole('Stranger (as his Mum)'), 'Stranger, as his Mum');
  assert.equal(spokenRole('Clerk as her Parent'), 'Clerk as her Parent');
  assert.equal(spokenRole('Keeper'), 'Keeper');
  const { model } = fixtureModel();
  const roles = asRoles(model);
  assert.ok(roles.length > 0);
  assert.ok(roles.every((r) => /\(as /.test(r)));
  const texts = clipTexts(manifestOf(model), model);
  assert.equal(texts.get(`p-${roles[0]}`), spokenRole(roles[0]));
});

test('the coach: says aloud and what a tap does; the phone reading aloud never mentions earbuds', () => {
  assert.match(COACH.intro, /aloud/);
  assert.match(COACH.intro, /That shows the app what to bring back\./);
  assert.match(COACH_SPEECH.intro, /aloud/);
  assert.doesNotMatch(COACH_SPEECH.intro, /earbud/);
  assert.match(COACH.end, /tap any you missed/);
  const { model } = fixtureModel();
  const manifest = speechManifest(model);
  assert.equal(clipTexts(manifest, model).get(manifest.coach.intro.file), COACH_SPEECH.intro);
  for (const text of [...Object.values(COACH), ...Object.values(COACH_SPEECH), ...Object.values(STEPS)]) assert.doesNotMatch(text, /[—–]/);
});

test('a cue that leads to more than one line: a member\'s pack has the lines before it, and their tape plays them', () => {
  const lines = [['ANNA', 'Morning.'], ['BEN', 'Are you coming?'], ['ANNA', 'No.'], ['CARL', 'Fine then.'], ['BEN', 'Are you coming?'], ['ANNA', 'Yes.']];
  const m = buildModel({ scenes: [{ name: 'Scene 1', title: '', events: lines.map(([role, text]) => ({ t: 'speech', role, lines: [text] })) }] });
  const [, coming, no, fine, comingAgain, yes] = m.items;
  const audio = { manifest: { ...manifestOf(m), sampleRate: 22050, bitrate: 32000, made: 'test' }, clips: { get: () => new Uint8Array([1]) } };
  const { sub, zip } = memberPack(m, { name: 'Anna', ids: [no.id, yes.id] }, audio);
  const inside = unzipSync(zip);
  const manifest = JSON.parse(strFromU8(inside['manifest.json']));
  assert.equal(manifest.items[coming.id].line.file, `l-${coming.id}`);
  assert.equal(manifest.items[comingAgain.id].cue.file, `c-${comingAgain.id}`, 'the first lead line brings its cue');
  for (const ref of Object.values(manifest.items)) assert.ok(inside[ref.line.file]);
  assert.equal(sub.items.length, 2, 'the model still holds only their own lines');
  assert.equal(inside[`l-${fine.id}`], undefined, 'and only the clips the cue needs');
  const app = fakeApp();
  const index = indexModel(sub);
  const tape = buildWalk({ model: sub, index, manifest, getState: app.getState, settings: app.settings, plan: { k: 1, newBeats: sub.beats.map((b) => b.id), ahead: [] }, start: app.clock, seconds: 3600 });
  const timed = timeline(tape);
  const check = tape.trials.find((tr) => tr.id === yes.id);
  const before = timed.filter((s) => s.clip && s.at >= check.replayFrom - 1e-9 && s.at < check.start - 1e-9).map((s) => s.clip);
  assert.deepEqual(before, [`c-${comingAgain.id}`, `l-${comingAgain.id}`]);
  const texts = clipTexts(manifest, sub);
  assert.equal(texts.get(`l-${comingAgain.id}`), 'Are you coming?', 'the phone can read them too');
  assert.equal(texts.get(`c-${comingAgain.id}`), 'Fine then.');
});

test('a walk kept from days ago changes nothing on a line answered since', () => {
  const later = { ...newState('a'), status: 'review', proved: true, lastTime: 5000 };
  const fresh = newState('b');
  const states = { a: later, b: fresh };
  const records = walkRecords([{ id: 'a', pass: false, at: 1, queue: 'run' }, { id: 'b', pass: true, at: 2, queue: 'run' }], { start: 1000, getState: (id) => states[id] });
  assert.deepEqual(records.map((r) => r.event.id), ['b']);
});
