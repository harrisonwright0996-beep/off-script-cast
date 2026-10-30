// A pupil's whole journey, with the invented play and a stand in for the worker.
import { test, expect, enrol, open, keysOf, fakeWorker, answerCard, CODE } from './helpers.mjs';

test('a wrong code is told so kindly, and nothing is unlocked', async ({ page }) => {
  await open(page);
  await page.getByLabel('Company code').fill('wrong words here please');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toContainText('not right');
  expect(await page.evaluate(() => window.offScript.model)).toBeNull();
});

test('code in odd capitals and spacing works; only their lines arrive', async ({ page }) => {
  await open(page);
  await page.getByLabel('Company code').fill('  OTTER lamp-River  nine ');
  await page.getByRole('button', { name: 'Unlock' }).click();
  const names = page.getByRole('main').getByRole('button');
  await expect(names).toHaveCount(2);
  await names.nth(1).click();
  await page.getByRole('button', { name: /^Yes, I am/ }).click();
  await expect(page.getByRole('heading', { name: 'Already know some?' })).toBeVisible({ timeout: 30000 });
  const { all, speakers, clips } = await page.evaluate(async () => {
    const o = window.offScript;
    return { all: o.model.items.length, speakers: new Set(o.model.items.map((it) => it.speaker)).size, clips: Object.keys(o.manifest.items).length };
  });
  expect(speakers).toBe(1);
  expect(clips).toBe(all);
});

test('it opens straight to their lines the next time, and no date or time to spend is shown', async ({ page }) => {
  await enrol(page);
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  await expect(page.locator('.ring-num')).toHaveText('0%');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your lines' })).toBeVisible();
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/minutes|hours|November|December|October|Monday|Tuesday|Wednesday|Thursday|Friday|by then|deadline/i);
  await page.screenshot({ path: `shots/${test.info().project.name}-your-lines.png`, fullPage: true });
});

// The keys for the line on show in the check of what you know, or wrong ones.
const checkKeys = (page, wrong = false) => page.evaluate((wrong) => {
  const n = Number(document.querySelector('.where').textContent.match(/: (\d+) of/)[1]);
  return window.offScript.model.items[n - 1].tokens.filter((t) => t.k !== null).map((t) => (wrong ? (t.k === 'z' ? 'p' : 'z') : t.k)).join('');
}, wrong);

test('already know some: typed right needs no teaching, but the % waits for another day; it can stop', async ({ page }) => {
  await enrol(page);
  await page.getByRole('button', { name: 'Yes, check what I know' }).click();
  // Scene one: the first two lines right.
  for (let i = 0; i < 2; i++) {
    await expect(page.locator('.where')).toHaveText(`Checking your lines: ${i + 1} of 23`);
    await page.keyboard.type(await checkKeys(page));
  }
  await expect(page.locator('.result.perfect')).toHaveText(/Word perfect/);
  await page.getByRole('button', { name: 'That is enough, teach me' }).click();
  await expect(page.getByText(/You already know 2 lines/)).toBeVisible();
  await expect(page.getByText('These lines will not need teaching. Type each one once more on another day and it counts towards your %.')).toBeVisible();
  await expect(page.locator('main')).not.toContainText('% learnt');
  await page.getByRole('button', { name: 'Start learning' }).click();
  await expect(page.getByRole('heading', { name: 'Your lines' })).toBeVisible();
  await expect(page.locator('.ring-num')).toHaveText('0%');
  const known = await page.evaluate(() => {
    const v = [...window.offScript.states.values()];
    return [v.filter((s) => s.status === 'review').length, v.filter((s) => s.proved).length, window.offScript.plan().ready.size];
  });
  expect(known).toEqual([2, 0, 0]);
});

test('already know some: one try a line, for good, even a line left part way or started again', async ({ page }) => {
  await enrol(page);
  await expect(page.getByText('Each line gets one try.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Yes, check what I know' }).click();
  await page.keyboard.type(await checkKeys(page, true)); // the first line wrong
  await expect(page.locator('.result.misses')).toHaveText(/You will learn it/);
  await expect(page.locator('.where')).toHaveText('Checking your lines: 2 of 23');
  await page.keyboard.press('?'); // a look at the second, then away
  await page.getByRole('button', { name: 'That is enough, teach me' }).click();
  await page.getByRole('button', { name: 'Start learning' }).click();
  await page.getByRole('button', { name: 'My lines' }).click();
  await page.getByRole('button', { name: 'Already know some? Check them' }).click();
  await page.getByRole('button', { name: 'Yes, check what I know' }).click();
  await expect(page.locator('.where')).toHaveText('Checking your lines: 1 of 21');
  await page.evaluate(async () => {
    const o = window.offScript;
    await o.startAgain();
    await o.go('checkin');
  });
  await page.getByRole('button', { name: 'Yes, check what I know' }).click();
  await expect(page.locator('.where')).toHaveText('Checking your lines: 1 of 21');
});

test('already know some: with every line tried, it says so kindly', async ({ page }) => {
  await enrol(page);
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  await page.evaluate(async () => {
    const o = window.offScript;
    await o.store.set('checkTried', o.model.items.map((it) => it.id));
    await o.go('checkin');
  });
  await expect(page.getByText('You have checked all you can.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Yes, check what I know' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to your lines' }).click();
  await expect(page.getByRole('heading', { name: 'Your lines' })).toBeVisible();
});

test('already know some: two misses in a row say the rest of the scene is skipped', async ({ page }) => {
  await enrol(page);
  await page.getByRole('button', { name: 'Yes, check what I know' }).click();
  await page.keyboard.type(await checkKeys(page, true));
  await expect(page.locator('.where')).toContainText('2 of 23');
  await page.keyboard.type(await checkKeys(page, true));
  await expect(page.locator('.result.misses')).toHaveText(/two in a row, so we will skip the rest of this scene/);
  await expect(page.locator('#live')).toContainText('skip the rest of this scene');
  await expect(page.locator('.where')).toContainText('5 of 23'); // the next scene
});

test('the end of a round says what it gained', async ({ page }) => {
  await enrol(page);
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  await page.evaluate(() => window.offScript.saveSettings({ sprintMinutes: 0.01, mode: 'type' }));
  await page.getByRole('button', { name: 'Start learning' }).click();
  for (let i = 0; i < 40 && (await page.locator('h1').textContent()) !== 'Round done'; i++) await answerCard(page);
  await expect(page.getByRole('heading', { name: 'Round done' })).toBeVisible();
  await expect(page.locator('main .lead')).toHaveText(/^\d+ lines? on (its|their) way\.$/);
  await page.getByRole('button', { name: 'Back to your lines' }).click();
  await expect(page.locator('.ring-num')).toHaveText('0%');
  await page.evaluate(async () => {
    const o = window.offScript;
    const it = o.model.items[0];
    const day = o.today();
    o.states.set(it.id, { ...o.getState(it.id), status: 'review', firstDay: day, learnedDay: day, passes: 3, helped: 1, stability: 200, passDays: [day], lastResult: 'pass', lastDay: day, lastTime: Date.now() - 3600000 });
    await o.go('sprint', { scope: 'tests', minutes: 2 });
  });
  await page.locator('.keypad').waitFor();
  await page.keyboard.type(await keysOf(page));
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Checks done' })).toBeVisible();
  await expect(page.locator('main .lead')).toHaveText(/^Up \d+% to \d+%\.$/);
});

test('saying is not enough: the go that learns a line has to be typed, and is said aloud', async ({ page }) => {
  await enrol(page);
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  // A line said right but never typed: in a round, its next go from the cue is locked to typing.
  const id = await page.evaluate(() => {
    const o = window.offScript;
    const id = o.model.items[3].id;
    const day = o.today();
    o.states.set(id, { ...o.getState(id), status: 'review', firstDay: day, learnedDay: day, passes: 3, helped: 3, stability: 200, passDays: [day], lastResult: 'pass', lastDay: day, lastTime: Date.now() - 3600000, lastMode: 'say' });
    o.go('sprint', { scope: 'tests', minutes: 2 });
    return id;
  });
  await page.waitForFunction(() => window.offScript.card && window.offScript.card.step === 'floor');
  await expect(page.locator('.spot')).toHaveText('Type this one so it counts towards your %.');
  expect(await page.locator('.spot').getAttribute('role')).toBeNull();
  await expect(page.locator('#live')).toHaveText('Type this one so it counts towards your %.');
  await expect(page.getByRole('button', { name: 'Say it instead' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: /Keypad/ })).toBeVisible();
  await page.keyboard.type(await keysOf(page));
  await expect(page.locator('.result')).toBeVisible();
  expect(await page.evaluate((id) => window.offScript.states.get(id).proved, id)).toBe(true);
  await page.screenshot({ path: `shots/${test.info().project.name}-typed.png`, fullPage: true });
});

test('% learnt moves only for proved lines, and a milestone shows once', async ({ page }) => {
  await enrol(page);
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  await page.evaluate(async () => {
    const o = window.offScript;
    const day = o.today();
    const half = o.model.items.slice(0, Math.ceil(o.model.items.length * 0.6));
    for (const it of half) o.states.set(it.id, { ...o.getState(it.id), status: 'review', firstDay: day, learnedDay: day, passes: 3, stability: 200, passDays: [day], lastResult: 'pass', lastDay: day, lastTime: Date.now(), proved: true });
    await o.go('today');
  });
  await expect(page.locator('.moment')).toContainText('learnt');
  await page.screenshot({ path: `shots/${test.info().project.name}-moment.png`, fullPage: true });
  await page.evaluate(() => window.offScript.go('today'));
  await expect(page.getByRole('heading', { name: 'Your lines' })).toBeVisible();
  await expect(page.locator('.moment')).toHaveCount(0);
});

test('a walk says what to do now, in words, and the tape has the coach in it', async ({ page }) => {
  await enrol(page);
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  await page.getByRole('button', { name: 'Walk' }).click();
  await page.getByRole('button', { name: '5 minutes', exact: true }).click();
  await expect(page.locator('.guide')).toContainText('New line: just listen');
  const clips = await page.evaluate(() => window.offScript.walk.tape.steps.filter((s) => s.clip).map((s) => s.clip));
  expect(clips[0]).toBe('k-intro.mp3');
  expect(clips).toContain('k-listen.mp3');
  expect(clips).toContain('k-turn.mp3');
  await page.screenshot({ path: `shots/${test.info().project.name}-walk.png`, fullPage: true });
});

test('code again after removing everything: the phone is clean', async ({ page }) => {
  await enrol(page);
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Not you? Remove everything' }).click();
  await page.getByRole('button', { name: 'Remove everything' }).click();
  await expect(page.getByLabel('Company code').or(page.getByRole('button', { name: 'Carry on without installing' }))).toBeVisible();
});

test('the install screen fits the device', async ({ page }, info) => {
  await fakeWorker(page);
  await page.goto('./');
  if (info.project.name === 'webkit') {
    await expect(page.getByRole('heading', { name: 'Install Off Script' })).toBeVisible();
    await expect(page.getByText('Add to Home Screen', { exact: false }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Not your device? See all the steps' }).click();
    await expect(page.getByRole('heading', { name: 'Android', exact: true })).toBeVisible();
    await page.screenshot({ path: `shots/${info.project.name}-install.png`, fullPage: true });
  } else await expect(page.getByLabel('Company code')).toBeVisible();
});

test('a long random run as a pupil: nothing breaks, and % learnt stays between 0 and 100', async ({ page }) => {
  test.setTimeout(240000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await enrol(page);
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  await page.getByRole('button', { name: 'Start learning' }).click();
  let seed = 7;
  const roll = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let go = 0; go < 400; go++) {
    const on = async (name, exact = true) => {
      const b = page.getByRole('button', { name, exact });
      if (!(await b.count())) return false;
      await b.first().click({ timeout: 2000 }).catch(() => {}); // the screen may have moved on
      return true;
    };
    await page.waitForTimeout(20);
    const keypad = page.locator('.keypad');
    if (await keypad.isVisible()) {
      const keys = await keysOf(page);
      await page.keyboard.type(roll() < 0.2 ? `${keys[0] === 'z' ? 'x' : 'z'}${keys.slice(1)}` : keys);
    } else if (!(await on('Next')) && !(await on('Teach me')) && !(await on('Reveal'))) {
      if (await on('Done')) continue;
      if (!(await on('Another round')) && !(await on('Learn more now')) && !(await on('An extra run')) && !(await on('Start learning'))) await on('Back to your lines');
    }
  }
  const ring = Number((await page.evaluate(() => window.offScript.go('today').then(() => document.querySelector('.ring-num').textContent))).replace('%', ''));
  expect(ring).toBeGreaterThanOrEqual(0);
  expect(ring).toBeLessThanOrEqual(100);
  expect(await page.evaluate(() => window.offScript.events.length)).toBeGreaterThan(40);
  expect(errors).toEqual([]);
});

test('screens to look at, on the invented play', async ({ page }, info) => {
  test.skip(info.project.name !== 'webkit', 'the phone install screen shows only on an iPhone');
  const shot = (name) => page.screenshot({ path: `shots/${info.project.name}-cast-${name}.png` });
  await page.addInitScript(() => localStorage.clear());
  await fakeWorker(page);
  await page.goto('./');
  await shot('1-install');
  await page.getByRole('button', { name: 'Carry on without installing' }).click();
  await expect(page.getByLabel('Company code')).toBeVisible();
  await shot('2-unlock');
  await page.getByLabel('Company code').fill(CODE);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('button', { name: 'Whole Company', exact: true }).waitFor();
  await shot('3-pick');
  await page.getByRole('button', { name: 'Whole Company', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, I am Whole Company' }).click();
  await expect(page.getByRole('heading', { name: 'Already know some?' })).toBeVisible({ timeout: 30000 });
  await shot('4-checkin');
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  await expect(page.getByRole('heading', { name: 'Your lines', exact: true })).toBeVisible();
  await shot('5-your-lines');
  await page.getByRole('button', { name: 'Walk' }).click();
  await shot('6-walk');
});

test('Starting a scene again keeps a saved walk that does not touch it, and drops one that does', async ({ page }) => {
  await enrol(page);
  const kept = await page.evaluate(async () => {
    const o = window.offScript;
    const [a, b] = o.model.items.map((it) => it.id);
    const draft = { trials: [{ id: a }] };
    await o.store.set('walkDraft', draft);
    await o.store.clearProgress([b]);
    const after = !!(await o.store.get('walkDraft'));
    await o.store.clearProgress([a]);
    return [after, !!(await o.store.get('walkDraft'))];
  });
  expect(kept).toEqual([true, false]);
});

test('the first round ends with the offer of reminders; an answer ends it everywhere, and leaving does not', async ({ page }) => {
  // Test WebKit has no push, as a phone's browser has before the app is installed.
  await page.addInitScript(() => {
    window.PushManager ||= function () {};
    window.Notification ||= function () {};
  });
  await enrol(page);
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  await page.evaluate(() => (window.offScript.settings.sprintMinutes = 0.02));
  await page.getByRole('button', { name: 'Start learning' }).click();
  await page.waitForTimeout(1300);
  await expect(async () => {
    await answerCard(page);
    await expect(page.getByRole('heading', { name: 'Round done' })).toBeVisible({ timeout: 300 });
  }).toPass({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Yes, remind me' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to your lines' }).click();
  await expect(page.getByRole('button', { name: 'Yes, remind me' })).toBeInViewport();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByText('No reminders. You can turn them on in Settings.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your lines', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Yes, remind me' })).toHaveCount(0);
});

test('typing is explained with the keypad; one wrong word on a long line passes, and the screen does not say why', async ({ page }) => {
  await enrol(page);
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  await page.evaluate(async () => {
    const o = window.offScript;
    await o.saveSettings({ mode: 'type' });
    const it = o.model.items.find((x) => x.words >= 8);
    const day = o.today();
    o.states.set(it.id, { ...o.getState(it.id), status: 'review', firstDay: day, learnedDay: day, passes: 3, helped: 1, stability: 200, passDays: [day], lastResult: 'pass', lastDay: day, lastTime: Date.now() - 3600000, proved: true });
    await o.store.putStates([o.states.get(it.id)]);
    o.go('sprint', { custom: { itemIds: [it.id], help: 'none' } });
  });
  await expect(page.locator('.key-caption')).toHaveText('Tap the first letter of each word');
  const hint = page.getByText('just its first letter', { exact: false });
  await expect(hint).toBeVisible();
  const keys = await keysOf(page);
  const wrong = keys[1] === 'z' ? 'p' : 'z';
  await page.locator(`.keypad [data-key="${keys[0]}"]`).click();
  await expect(hint).toHaveCount(0);
  await expect(page.locator('.key-caption')).toBeVisible();
  await page.locator(`.keypad [data-key="${wrong}"]`).click();
  for (const k of keys.slice(2)) await page.locator(`.keypad [data-key="${k}"]`).click();
  await expect(page.locator('.result.perfect')).toHaveText(/Nearly word perfect\. Watch out for: /);
  await expect(page.getByRole('button', { name: 'Undo last answer' })).toHaveCount(0);
  expect(await page.evaluate(() => window.offScript.getState(window.offScript.card.item.id).proved)).toBe(true);
  const seen = (await page.locator('main').innerText()).toLowerCase();
  expect(seen).not.toMatch(/one (word|miss)|allowed|8 words|eight words|still (pass|count)/);
});
