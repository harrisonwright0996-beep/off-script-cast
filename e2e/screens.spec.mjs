import { readFileSync } from 'node:fs';
import { test, expect, importScript, importPack, answerCard, chooseFile, enrol, open, fakeWorker, CODE } from './helpers.mjs';

const shot = (page, name) => page.screenshot({ path: `shots/${test.info().project.name}-${name}.png`, fullPage: true });

test('scenes and the reader: numbers, brackets, on screen text; learn a scene next; run it', async ({ page }) => {
  await importScript(page);
  await page.getByRole('button', { name: 'Read my lines' }).click();
  await expect(page.getByRole('heading', { name: 'Read my lines' })).toBeVisible();
  await expect(page.getByText('lines word perfect', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: /Scene 3: Landfall/ }).click();
  await expect(page.getByRole('heading', { name: 'Scene 3: Landfall' })).toBeVisible();
  await page.getByRole('button', { name: 'Learn this scene next' }).click();
  await expect(page.getByRole('button', { name: 'Learn this scene next' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.offScript.index.beatById.get(window.offScript.plan().newBeats[0]).scene)).toBe(3);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: /Scene 1: The Harbour/ }).click();
  await expect(page.locator('.reader')).not.toContainText('[On screen] Phone New message: where are you?'); // only what the member speaks
  await expect(page.locator('.reader .n').first()).toHaveText('1');
  await shot(page, 'reader');
  await page.getByRole('button', { name: 'Try a run of this scene' }).click();
  await expect(page.getByRole('heading', { name: 'Run: Scene 1: The Harbour' })).toBeVisible();
  await expect(page.getByText('Line 1 of 13', { exact: false })).toBeVisible();
  await answerCard(page);
  await expect(page.getByText('Line 2 of 13', { exact: false })).toBeVisible();
});

test('settings: look changes at once; back up, restore, remove everything', async ({ page }) => {
  await page.addInitScript(() => {
    // Force the download path for backups: no share sheet in a test browser.
    Object.defineProperty(navigator, 'canShare', { value: undefined });
  });
  await importScript(page);
  await page.getByRole('button', { name: 'Start learning' }).click();
  for (let i = 0; i < 10; i++) await answerCard(page); // the first beat read, then into its run
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Colours').selectOption({ label: 'Dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('Text size').selectOption({ label: '150%' });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--scale').trim())).toBe('1.5');
  await shot(page, 'settings-dark-150');
  await page.getByLabel('Text size').selectOption({ label: '100%' });

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Back up progress' }).click();
  const file = await (await download).path();
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  expect(backup.app).toBe('off-script-cast');
  expect(backup.states.length).toBeGreaterThan(0);
  const states = await page.evaluate(() => window.offScript.states.size);

  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: 'Remove everything' }).click();
  await expect(page.getByRole('heading', { name: 'Remove everything?' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove everything' }).click();
  await expect(page.getByRole('button', { name: 'Carry on without installing' }).or(page.getByLabel('Company code'))).toBeVisible(); // the page starts afresh first
  await importScript(page);
  expect(await page.evaluate(() => window.offScript.states.size)).toBe(0);

  await page.getByRole('button', { name: 'Settings' }).click();
  await chooseFile(page, 'Restore a backup', { name: 'Off Script progress.json', mimeType: 'application/json', buffer: readFileSync(file) });
  await expect(page.getByRole('heading', { name: 'Restore this backup?' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your lines', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.offScript.states.size)).toBe(states);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

// What is kept on the phone for these lines: their states and answers, and any sprint or practice part way.
const kept = (page, scene = null) =>
  page.evaluate(async (scene) => {
    const o = window.offScript;
    const ours = (id) => scene === null || o.model.scenes[scene].itemIds.includes(id);
    return {
      states: (await o.store.allStates()).filter((st) => ours(st.id)).length,
      answers: (await o.store.allEvents()).filter((e) => ours(e.id)).length,
      saved: [(await o.store.get('sprint')) ?? null, (await o.store.get('practice')) ?? null].filter(Boolean).length,
    };
  }, scene);

test('start again from 0%: every line back to not started; the lines, audio and settings stay', async ({ page }) => {
  await importScript(page);
  await importPack(page);
  await page.getByRole('button', { name: 'Start learning' }).click();
  for (let i = 0; i < 10; i++) await answerCard(page); // the first beat read, then into its run
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Colours').selectOption({ label: 'Dark' });
  await page.getByRole('button', { name: 'Start again from 0%' }).click();
  await expect(page.getByRole('heading', { name: 'Start again from 0%?' })).toBeVisible();
  await expect(page.getByText('Your lines, audio and settings stay.', { exact: false })).toBeVisible();
  await shot(page, 'start-again');
  await page.getByRole('button', { name: 'Keep my progress' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  expect((await kept(page)).states).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Start again from 0%' }).click();
  await page.getByRole('button', { name: 'Start again from 0%' }).click();
  await expect(page.getByRole('heading', { name: 'Your lines', exact: true })).toBeVisible();
  expect(await kept(page)).toEqual({ states: 0, answers: 0, saved: 0 });
  expect(await page.evaluate(() => [window.offScript.states.size, window.offScript.events.length])).toEqual([0, 0]);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your lines', exact: true })).toBeVisible(); // the script stays
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); // and the settings
  await page.getByRole('button', { name: 'Settings' }).click();
  expect(await page.evaluate(() => !!window.offScript.manifest)).toBe(true); // and the audio
  await expect(page.getByRole('button', { name: 'Start again from 0%' })).toHaveCount(0); // nothing to start again
  await page.getByRole('button', { name: 'Your lines', exact: true }).click();
  await page.getByRole('button', { name: 'Start learning' }).click();
  await expect(page.getByText('Start of Prologue')).toBeVisible(); // from the first line again
});

test('start this scene again: its lines go back to not started, other scenes keep theirs', async ({ page }) => {
  await importScript(page);
  await page.getByRole('button', { name: 'Start learning' }).click();
  await page.getByRole('button', { name: 'Try it' }).click();
  await page.waitForFunction(() => window.offScript.card.step === 'floor');
  await answerCard(page); // the Prologue's first line, right at the first try
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'Choose' }).click();
  await page.getByLabel('Where').selectOption({ label: 'Scene 1: The Harbour' });
  await page.getByLabel('Which lines').selectOption({ label: 'Every line' });
  await page.getByLabel('How much help').selectOption({ label: 'No help' });
  await page.getByRole('button', { name: 'Start' }).click();
  for (let i = 0; i < 3; i++) await answerCard(page); // three lines of Scene 1
  await page.getByRole('button', { name: 'Stop' }).click();
  const prologue = await kept(page, 0);
  expect(prologue.states).toBe(1);
  expect((await kept(page, 1)).states).toBe(3);

  await page.getByRole('button', { name: 'Read my lines' }).click();
  await page.getByRole('button', { name: /Prologue/ }).click();
  await expect(page.getByRole('button', { name: 'Start this scene again' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: /Scene 1: The Harbour/ }).click();
  await page.getByRole('button', { name: 'Start this scene again' }).click();
  await expect(page.getByRole('heading', { name: 'Start this scene again?' })).toBeVisible();
  await expect(page.getByText('Every line of Scene 1: The Harbour goes back to not started', { exact: false })).toBeVisible();
  await shot(page, 'start-scene-again');
  await page.getByRole('button', { name: 'Start this scene again' }).click();
  await expect(page.getByRole('heading', { name: 'Scene 1: The Harbour' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try a run of this scene' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start this scene again' })).toHaveCount(0);
  expect(await kept(page, 1)).toEqual({ states: 0, answers: 0, saved: 0 });
  expect(await kept(page, 0)).toEqual({ ...prologue, saved: 0 }); // the Prologue keeps its progress
});

// Learnt, proved and fresh: the first n lines, all others untouched.
const learnt = (page, share, extra = {}) =>
  page.evaluate(
    async ([share, extra]) => {
      const o = window.offScript;
      const day = o.today();
      o.states = new Map();
      for (const it of o.model.items.slice(0, Math.ceil(o.model.items.length * share))) {
        o.states.set(it.id, { ...o.getState(it.id), status: 'review', firstDay: day, learnedDay: day, passes: 3, stability: 2000, passDays: [day], lastResult: 'pass', lastDay: day, lastTime: Date.now(), proved: true, ...extra });
      }
      await o.go('today');
    },
    [share, extra],
  );
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const focused = (page) => page.evaluate(() => document.activeElement.tagName);
const seen = (page) => page.evaluate(() => window.offScript.store.get('seen'));
const stored = (page, key) => page.evaluate((key) => window.offScript.store.get(key), key);

for (const width of [393, 320]) {
  test(`the keypad at ${width} wide: every key whole, and no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await importScript(page);
    await page.getByRole('button', { name: 'Start learning' }).click();
    await page.getByRole('button', { name: 'Try it' }).click();
    await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: 'Keeper', exact: true }).click();
    await expect(page.getByRole('group', { name: /Keypad/ })).toBeVisible();
    const keys = await page.locator('.key').evaluateAll((all) => all.map((k) => ({ key: k.dataset.key, ...k.getBoundingClientRect().toJSON() })));
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) {
      expect(k.left, k.key).toBeGreaterThanOrEqual(0);
      expect(k.right, k.key).toBeLessThanOrEqual(width);
    }
    expect(await sideways(page)).toBe(0);
  });
}

test('big text on a small phone: the footer goes with the page, the ring fits, nothing pans, and words stay whole', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await importScript(page);
  const wholeWords = () =>
    page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const lines = Math.round(h1.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight));
      return lines <= h1.textContent.split(' ').length;
    });
  for (const textSize of [175, 200]) {
    await page.evaluate((textSize) => window.offScript.saveSettings({ textSize }).then(() => window.offScript.go('today')), textSize);
    await expect(page.locator('footer')).toHaveCSS('position', 'static');
    expect(await sideways(page)).toBe(0);
    const [ring, num, main] = await Promise.all(['.ring', '.ring-num', 'main'].map((s) => page.locator(s).evaluate((el) => el.getBoundingClientRect().toJSON())));
    expect(ring.right).toBeLessThanOrEqual(main.right);
    expect(ring.height).toBeCloseTo(ring.width, 0);
    expect(num.width).toBeLessThan(ring.width);
    expect(await page.locator('footer .btn').evaluateAll((all) => all.filter((b) => b.scrollWidth > b.clientWidth).map((b) => b.textContent))).toEqual([]);
    await page.locator('.lights').scrollIntoViewIfNeeded(); // the scenes can be reached, not hidden behind the footer
    await expect(page.locator('.lights')).toBeInViewport({ ratio: 0.1 });

    for (const [screen, params] of [['reader', { scene: 1 }], ['choose', {}], ['scenes', {}], ['settings', {}]]) {
      await page.evaluate(([screen, params]) => window.offScript.go(screen, params), [screen, params]);
      await expect(page.locator('h1')).toBeVisible();
      expect(await sideways(page), screen).toBe(0);
      expect(await wholeWords(), screen).toBe(true);
    }
    await page.evaluate(() => window.offScript.go('reader', { scene: 1 }));
    await expect(page.locator('.reader .speech').first()).toBeInViewport(); // the words can be read
    await expect(page.locator('footer')).toHaveCSS('position', 'static');
  }

  // A normal size keeps its footer on screen, and the keypad stays at any size.
  await page.evaluate(() => window.offScript.saveSettings({ textSize: 100 }).then(() => window.offScript.go('choose')));
  await expect(page.locator('footer')).toHaveCSS('position', 'sticky');
  await page.evaluate(() => window.offScript.saveSettings({ textSize: 200 }).then(() => window.offScript.go('today')));
  await page.getByRole('button', { name: 'Start learning' }).click();
  await page.getByRole('button', { name: 'Try it' }).click();
  await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: 'Keeper', exact: true }).click();
  await expect(page.locator('footer')).toHaveCSS('position', 'sticky');
});

test('the company code field is a proper field, at least 44 points tall', async ({ page }) => {
  await open(page);
  const field = page.getByLabel('Company code');
  expect((await field.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await expect(field).toHaveCSS('border-top-width', '2px');
});

test('a code that fails stays in the box, with the problem tied to it', async ({ page }) => {
  await open(page);
  const field = page.getByLabel('Company code');
  await field.fill('wrong words here please');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toContainText('not right');
  await expect(field).toHaveValue('wrong words here please');
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', await page.getByRole('alert').getAttribute('id'));
});

test('not four words is said at once, without asking the worker; a pasted code is tidied', async ({ page }) => {
  await open(page);
  const calls = [];
  await fakeWorker(page, { calls });
  const field = page.getByLabel('Company code');
  await field.fill('otter lamp river');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toHaveText('That is not quite it: the code is four words.');
  await expect(field).toHaveValue('otter lamp river');
  expect(calls).toEqual([]);
  await field.fill(`Code: "${CODE}"`);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Who are you?' })).toBeVisible();
  await expect(page.getByText('Pick your name to get your lines.')).toBeVisible();
});

// The next pack asked for does not come until released.
const holdPack = (page) =>
  page.evaluate(() => {
    const real = window.fetch;
    let held = true;
    const gate = new Promise((go) => (window.releasePack = go));
    window.fetch = async (url, options) => {
      if (held && /\/f\/p\d/.test(url)) {
        held = false;
        await gate;
      }
      return real(url, options);
    };
  });

async function upToDownload(page) {
  await open(page);
  await page.getByLabel('Company code').fill(CODE);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('button', { name: 'Whole Company', exact: true }).click();
  await holdPack(page);
  await page.getByRole('button', { name: 'Yes, I am Whole Company' }).click();
  await expect(page.getByRole('heading', { name: 'Getting your lines' })).toBeVisible();
}

test('slow signal: the code is saved first, and after a while there is a way to try again', async ({ page }) => {
  await page.addInitScript(() => {
    const wait = window.setTimeout;
    window.setTimeout = (fn, ms, ...rest) => wait(fn, ms === 20000 ? 300 : ms, ...rest); // 20 seconds is too long for a test
  });
  await upToDownload(page);
  await expect.poll(() => stored(page, 'keys')).toBeTruthy();
  await page.getByRole('button', { name: 'Having trouble? Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Already know some?' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Having trouble? Try again' })).toHaveCount(0);
});

test('slow signal: given up and opened again, it goes straight to the names', async ({ page }) => {
  await upToDownload(page);
  await expect.poll(() => stored(page, 'keys')).toBeTruthy();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Who are you?' })).toBeVisible();
});

test('a pack that comes during a round waits for the next Your lines, and says the lines have changed', async ({ page }) => {
  await enrol(page);
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  await expect(page.getByRole('heading', { name: 'Your lines' })).toBeVisible();
  await holdPack(page);
  await page.evaluate(() => {
    const o = window.offScript;
    o.member.version = 'an older one';
    o.model.items[0].text += ' And a new thought.'; // as the phone had it before the script changed
    return o.go('today');
  });
  await page.getByRole('button', { name: 'Start learning' }).click();
  await page.waitForFunction(() => window.offScript.card);
  await page.evaluate(() => window.releasePack());
  await expect.poll(() => stored(page, 'newPack').then((p) => !!p), { timeout: 20000 }).toBe(true);
  expect(await page.evaluate(() => window.offScript.member.version)).toBe('an older one'); // nothing swapped mid round
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByText('Your lines have been updated.')).toBeVisible();
  expect(await page.evaluate(() => window.offScript.member.version)).toBe('v1');
  expect(await stored(page, 'newPack')).toBeUndefined();
  await page.evaluate(() => window.offScript.go('today'));
  await expect(page.getByText('Your lines have been updated.')).toHaveCount(0);
});

test('a new pack that leaves these lines as they were says nothing', async ({ page }) => {
  await enrol(page);
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  await page.evaluate(() => {
    window.offScript.member.version = 'an older one';
    return window.offScript.go('today');
  });
  await expect.poll(() => page.evaluate(() => window.offScript.member.version), { timeout: 20000 }).toBe('v1');
  await expect(page.getByRole('heading', { name: 'Your lines' })).toBeVisible();
  await expect(page.getByText('Your lines have been updated.')).toHaveCount(0);
});

const showOver = async (page) => {
  await expect(page.getByText('The show is over, so your lines have been removed from this phone. Well done.')).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).filter((n) => n === 'off-script-cast').length)).toBe(0);
  expect(await page.evaluate(() => [localStorage.length, window.offScript.model, window.offScript.keys])).toEqual([0, null, null]);
};

test('the worker says the show is over: everything goes from the phone, with a plain goodbye', async ({ page }) => {
  await enrol(page);
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  await expect(page.getByRole('heading', { name: 'Your lines' })).toBeVisible();
  await page.evaluate(async () => {
    const { CastError } = await import(new URL('src/cast/client.js', location.href).href);
    const o = window.offScript;
    const { key } = o.keys;
    o.keys = { key, get token() { throw new CastError('gone'); } }; // what a 410 comes to
    await o.go('today');
  });
  await showOver(page);
});

test('past the last day: everything goes at boot, and it stays gone', async ({ page }) => {
  await enrol(page);
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  await expect(page.getByRole('heading', { name: 'Your lines' })).toBeVisible();
  await page.addInitScript(() => {
    const Real = Date;
    const later = 120 * 86400000;
    globalThis.Date = class extends Real {
      constructor(...args) {
        if (args.length) super(...args);
        else super(Real.now() + later);
      }

      static now() {
        return Real.now() + later;
      }
    };
  });
  await page.reload();
  await showOver(page);
  await page.reload();
  await showOver(page);
});

test('Remove everything tells the worker to forget the reminders first', async ({ page }) => {
  await enrol(page);
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  const calls = [];
  await fakeWorker(page, { calls });
  await page.evaluate(() => window.offScript.store.set('push', { id: 'a-reminder' }));
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Not you? Remove everything' }).click();
  await page.getByRole('button', { name: 'Remove everything' }).click();
  await expect(page.getByLabel('Company code').or(page.getByRole('button', { name: 'Carry on without installing' }))).toBeVisible();
  expect(calls).toContain('/push/off');
});

test('saved data that stops the app starting can be removed from the error screen', async ({ page }) => {
  await enrol(page);
  await page.evaluate(() => window.offScript.store.set('script', { broken: true }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Off Script could not start' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove everything' }).click();
  await expect(page.getByRole('heading', { name: 'Remove everything?' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove everything' }).click();
  await expect(page.getByLabel('Company code').or(page.getByRole('button', { name: 'Carry on without installing' }))).toBeVisible();
});

test.describe('on Android', () => {
  test.use({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });

  test('Install with no offer says what to do; the cost of carrying on is said; focus stays on the page', async ({ page }) => {
    await fakeWorker(page);
    await page.goto('./');
    await expect(page.getByRole('heading', { name: 'Install Off Script' })).toBeVisible();
    await expect(page.getByText('If you carry on here and install later, you will start again.')).toHaveCount(0); // Android keeps the same storage
    await page.getByRole('button', { name: 'Install Off Script' }).click();
    await expect(page.getByText('Follow the steps above', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Not your device? See all the steps' }).click();
    await expect.poll(() => focused(page)).toBe('H2');
  });
});

test('Settings offers Install on a phone not yet installed', async ({ page }, info) => {
  await importScript(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const install = page.getByRole('button', { name: 'Install Off Script' });
  if (info.project.name === 'webkit') {
    await install.click();
    await expect(page.getByRole('heading', { name: 'Install Off Script' })).toBeVisible();
    await page.getByRole('button', { name: 'Carry on without installing' }).click();
    await expect(page.getByRole('heading', { name: 'Your lines', exact: true })).toBeVisible();
  } else await expect(install).toHaveCount(0);
});

test('Your lines says whose they are, and what 0% means', async ({ page }) => {
  await enrol(page);
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  await expect(page.getByText('Learning as Whole Company')).toBeVisible();
  await expect(page.getByText('Every line starts here. Your % grows as you learn.')).toBeVisible();
});

test('each moment comes once ever, one at a time, and a dip is explained', async ({ page }) => {
  await enrol(page);
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  await expect(page.getByRole('heading', { name: 'Your lines' })).toBeVisible();

  // The Prologue fully learnt and a milestone crossed at once: both are shown, and only then marked.
  await learnt(page, 0.4);
  await expect(page.locator('.moment-big')).toHaveText('50%');
  await expect(page.locator('.moment')).toContainText('Prologue is lit');
  await expect.poll(() => page.locator('#live').textContent()).toContain('Halfway there');
  await expect.poll(() => seen(page).then((s) => s.lit)).toEqual([0]);
  await page.evaluate(() => window.offScript.go('today'));
  await expect(page.getByRole('heading', { name: 'Your lines' })).toBeVisible();
  await expect(page.locator('.moment')).toHaveCount(0);

  // Down, then back past 25%: no second go at the moment, and the dip has words.
  await learnt(page, 0.1);
  await expect(page.getByText('Your % dipped because a line slipped. That is normal. Get it right again and it comes back.')).toBeVisible();
  await page.evaluate(() => window.offScript.go('today'));
  await expect(page.getByRole('heading', { name: 'Your lines' })).toBeVisible();
  await expect(page.getByText('Your % dipped', { exact: false })).toHaveCount(0);
  await learnt(page, 0.4);
  await expect(page.locator('.ring-num')).not.toHaveText('0%');
  await expect(page.locator('.moment')).toHaveCount(0);
});

test('starting again is not a slip: no dip is mentioned', async ({ page }) => {
  await enrol(page);
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  await learnt(page, 0.4);
  await expect(page.locator('.moment')).toBeVisible();
  await page.evaluate(() => window.offScript.startAgain().then(() => window.offScript.go('today')));
  await expect(page.getByText('Every line starts here. Your % grows as you learn.')).toBeVisible();
  await expect(page.getByText('Your % dipped', { exact: false })).toHaveCount(0);
});

test('lines ready to check: soft words, no count and no promise', async ({ page }) => {
  await enrol(page);
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  await learnt(page, 0.5, { stability: 1, lastTime: Date.now() - 96 * 3600000 });
  await expect(page.getByText('Some lines are ready for another go.')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('starting to fade');
  await expect(page.locator('body')).not.toContainText('brings');
});

test('every line learnt: one Run through, and one word about keeping them', async ({ page }) => {
  await enrol(page);
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  await learnt(page, 1);
  await expect(page.locator('.moment')).toContainText('100%');
  await expect(page.getByRole('button', { name: 'Run through' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Run through' })).toHaveClass(/primary/);
  await expect(page.getByText(/fade/)).toHaveCount(1);

  // Three scenes lit at once: each has its turn, and none is marked before it is shown.
  await expect(page.locator('.moment')).toContainText('Prologue is lit');
  for (const scene of ['Scene 1: The Harbour', 'Scene 3: Landfall']) {
    await page.evaluate(() => window.offScript.go('today'));
    await expect(page.locator('.moment')).toContainText(`${scene} is lit`);
  }
  await page.evaluate(() => window.offScript.go('today'));
  await expect(page.getByRole('heading', { name: 'Your lines' })).toBeVisible();
  await expect(page.locator('.moment')).toHaveCount(0);
});

test('the update notice and Not now leave the focus on the page', async ({ page }, info) => {
  await enrol(page);
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  await expect(page.getByRole('heading', { name: 'Your lines' })).toBeVisible();
  await page.evaluate(() => {
    window.offScript.update = {};
    document.dispatchEvent(new CustomEvent('offscript:update'));
  });
  await expect(page.getByText('A new version is ready.')).toBeVisible();
  await expect.poll(() => focused(page)).toBe('H1');
  await page.evaluate(() => (window.offScript.update = null));

  test.skip(!(await page.evaluate(() => 'PushManager' in window && 'Notification' in window)), 'no reminders in this browser');
  await page.evaluate(() => {
    const o = window.offScript;
    o.events.push({ time: Date.now(), day: o.today(), id: o.model.items[0].id, pass: true, mode: 'type', misses: 0 });
    return o.go('today');
  });
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByText('No reminders. You can turn them on in Settings.')).toBeVisible();
  await expect.poll(() => focused(page)).toBe('P');
});
