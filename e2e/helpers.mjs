// Shared steps for the browser tests. Only the invented play is ever loaded.
import { test as base, expect } from '@playwright/test';
import { fixtureModel } from '../tests/helpers.mjs';
import { buildFixturePack, silentMp3 } from '../tests/fixtures/audio-pack.mjs';
import { readAudioPack } from '../src/audiopack.js';
import { COACH } from '../src/coach.js';
import { noteKey } from '../src/tape.js';
import { castList, memberPack, sceneLines } from '../src/cast/build.js';
import { deriveKeys, seal } from '../src/cast/pack.js';

export { expect };

// Every test starts at noon on 28 October, whatever the real date, and time runs on from there:
// what a sprint shows depends on the date, and these tests are about the learning days of the plan.
const START = new Date('2026-10-28T12:00:00').getTime();
function shiftClock(offset) {
  const Real = Date;
  globalThis.Date = class extends Real {
    constructor(...args) {
      if (args.length) super(...args);
      else super(Real.now() + offset);
    }

    static now() {
      return Real.now() + offset;
    }
  };
}
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(shiftClock, START - Date.now());
    await use(context);
  },
});

export const CODE = 'otter lamp river nine';
export const WORKER = 'https://off-script-cast.off-script-lines.workers.dev';

// Everything the worker would hold for the invented play: sealed, as the real ones are.
let sealed = null;
async function workerFiles() {
  if (sealed) return sealed;
  const { model } = fixtureModel();
  const audio = readAudioPack(buildFixturePack(model));
  const coach = {};
  for (const key of Object.keys(COACH)) {
    audio.clips.set(`k-${key}.mp3`, silentMp3(20));
    coach[key] = { file: `k-${key}.mp3`, duration: (20 * 576) / 22050 };
  }
  const notes = {};
  for (const n of new Set(model.items.flatMap((it) => it.cue.notes))) {
    audio.clips.set(`n-${noteKey(n)}.mp3`, silentMp3(30));
    notes[noteKey(n)] = { file: `n-${noteKey(n)}.mp3`, duration: (30 * 576) / 22050 };
  }
  const keys = await deriveKeys(CODE);
  const speaker = model.items[1].speaker;
  const members = [
    { name: 'Whole Company', ids: model.items.map((it) => it.id) },
    { name: speaker, ids: model.items.filter((it) => it.speaker === speaker).map((it) => it.id) },
  ];
  const files = {};
  const list = [];
  const packs = [];
  for (const [i, m] of members.entries()) {
    const { sub, zip } = memberPack(model, { name: m.name, ids: m.ids }, audio, { coach, notes });
    files[`p${i}`] = await seal(keys.key, zip);
    list.push({ name: m.name, file: `p${i}`, lines: sub.items.length });
    packs.push({ file: `p${i}`, model: sub });
  }
  files.cast = await seal(keys.key, castList(list, 'v1'));
  files['scene-lines'] = await seal(keys.key, sceneLines(packs));
  sealed = { files, keys, list, speaker };
  return sealed;
}

// A stand in for the worker, inside the page. Playwright's WebKit cannot intercept a request from a
// page with a service worker, and these tests want the service worker running as on a real phone.
const faked = new WeakMap();
export const STAFF = 'night-ferry-staff-code';

export async function fakeWorker(page, { calls = [], progress = {}, listLags = () => false } = {}) {
  if (faked.has(page)) {
    faked.get(page).calls = calls;
    return;
  }
  const seen = { calls, progress };
  faked.set(page, seen);
  const { files, keys } = await workerFiles();
  await page.exposeFunction('castWorker', (path, headers, body) => {
    seen.calls.push(path);
    if (path === '/staff/remove') {
      if (headers['x-staff-token'] !== STAFF) return { status: 401 };
      if (!listLags()) delete seen.progress[JSON.parse(body).id]; // listLags: as the real list, for a minute or so
      return { status: 204 };
    }
    if (path === '/staff/owner') {
      if (headers['x-staff-token'] !== STAFF) return { status: 401 };
      const { id, owner } = JSON.parse(body);
      seen.progress[id].owner = owner;
      return { status: 204 };
    }
    if (path === '/staff') return headers['x-staff-token'] === STAFF ? { status: 200, bytes: Buffer.from(JSON.stringify(Object.values(seen.progress))).toString('base64') } : { status: 401 };
    if (headers['x-cast-token'] !== keys.token) return { status: 401 };
    if (path === '/progress') {
      const row = JSON.parse(body);
      seen.progress[row.id] = row;
      return { status: 204 };
    }
    const file = files[path.replace('/f/', '')];
    return file ? { status: 200, bytes: Buffer.from(file).toString('base64') } : { status: 404 };
  });
  await page.addInitScript((WORKER) => {
    const real = window.fetch;
    window.fetch = async (url, options = {}) => {
      if (!String(url).startsWith(WORKER)) return real(url, options);
      if (!navigator.onLine) throw new TypeError('Load failed');
      const { status, bytes } = await window.castWorker(String(url).slice(WORKER.length), options.headers, options.body);
      return new Response(bytes ? Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0)) : null, { status });
    };
  }, WORKER);
}

// Opens the app; a phone first asks to be installed, which tests skip.
export async function open(page, url = './') {
  await fakeWorker(page);
  await page.goto(url);
  const carryOn = page.getByRole('button', { name: 'Carry on without installing' });
  const welcome = page.getByRole('heading', { name: 'Welcome to Off Script' });
  const today = page.getByRole('heading', { name: 'Your lines', exact: true });
  await expect(carryOn.or(welcome).or(today)).toBeVisible();
  if (await carryOn.isVisible()) await carryOn.click();
}

// Unlocks, picks a member and starts from the beginning, as a pupil would.
export async function enrol(page, name = 'Whole Company', url = './', who = 'Test Pupil') {
  await open(page, url);
  await page.getByLabel('Company code').fill(CODE);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: 'Yes, these are my lines' }).click();
  await page.getByLabel('Your name').fill(who);
  await page.getByRole('button', { name: 'Carry on' }).click();
  const known = page.getByRole('heading', { name: 'Already know some?' });
  const notNow = page.getByRole('button', { name: 'Not now' }); // a browser with push is asked about reminders
  await expect(known.or(notNow)).toBeVisible({ timeout: 30000 });
  if (await notNow.isVisible()) await notNow.click();
  await expect(known).toBeVisible();
}

// For the tests of the engine: the whole play on the settings they were written for.
export async function importScript(page, url) {
  await enrol(page, 'Whole Company', url);
  await page.evaluate(() => window.offScript.saveSettings({ deadline: '2026-11-04', lastNewDay: '2026-11-01', proofs: false, mode: 'type', askSpeaker: true, sprintMinutes: 12, theme: 'cream' }));
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  await expect(page.getByRole('heading', { name: 'Your lines' })).toBeVisible();
}

// Your lines shows one thing to do; everything else is under More.
export async function more(page, name) {
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name }).click();
}

export const importPack = async () => {}; // the pack comes with the unlock

export async function chooseFile(page, buttonName, file) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: buttonName, exact: true }).click();
  await (await chooser).setFiles(file);
}

// The keys for the line on show: one first letter or digit per word.
export const keysOf = (page) => page.evaluate(() => window.offScript.card.item.tokens.filter((t) => t.k !== null).map((t) => t.k).join(''));

// Answers whatever card is on show, the way he would: teach new lines, say cards with help on them,
// choose the right speaker, type the line. miss: type a wrong first key, or tap the first word as
// missed on a card with help. Returns the card's step.
export async function answerCard(page, { miss = false } = {}) {
  await page.waitForFunction(() => window.offScript && window.offScript.card && document.querySelector('h1').textContent === window.offScript.card.label);
  const card = await page.evaluate(() => {
    const c = window.offScript.card;
    return { key: c.key, step: c.step, label: c.label, speaker: c.item.speaker, ask: !!c.askSpeaker };
  });
  if (card.step === 'test') await page.getByRole('button', { name: 'Teach me' }).click();
  else if (card.step === 'front') await page.getByRole('button', { name: 'Next', exact: true }).click();
  else {
    const say = async () => {
      await page.getByRole('button', { name: 'Reveal' }).click();
      if (miss) await page.getByRole('group', { name: 'Tap any word you missed or changed' }).getByRole('button').first().click();
      await page.getByRole('button', { name: 'Done' }).click();
    };
    if (card.step === 'help' || card.step === 'gaps') await say();
    else {
      if (card.ask) await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: card.speaker, exact: true }).click();
      if (await page.evaluate(() => window.offScript.settings.mode === 'say')) await say();
      else {
        const keys = await keysOf(page);
        await page.keyboard.type(miss ? (keys[0] === 'z' ? 'x' : 'z') + keys.slice(1) : keys);
      }
    }
    await expect(page.locator('.result')).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
  // Wait for the next card, or for a screen that is not a card (sprint done, plan done).
  await page.waitForFunction(([k, label]) => window.offScript.card.key !== k || document.querySelector('h1').textContent !== label, [card.key, card.label]);
  return card.step;
}

// Marks a line right from its cue alone once, half an hour ago, then opens a practice of just that line.
export async function seedOnce(page, id) {
  await page.evaluate((id) => {
    const o = window.offScript;
    const day = o.today();
    const time = Date.now() - 30 * 60000;
    o.states.set(id, { id, status: 'learning', firstDay: day, learnedDay: null, passes: 1, misses: 0, helped: 1, lapses: 0, stability: 1, passDays: [day], missDays: [], lastResult: 'pass', lastDay: day, lastTime: time, lastMode: 'say' });
    return o.go('sprint', { custom: { itemIds: [id] } });
  }, id);
  await page.waitForFunction(() => window.offScript.card && window.offScript.card.step === 'help');
}
