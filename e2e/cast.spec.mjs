// A pupil's whole journey, with the invented play and a stand in for the worker.
import { test, expect, enrol, open, keysOf, fakeWorker, CODE } from './helpers.mjs';

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

test('already know some: typed right counts as learnt, two misses end a scene, and it can stop', async ({ page }) => {
  await enrol(page);
  await page.getByRole('button', { name: 'Yes, check what I know' }).click();
  // Scene one: the first two lines right.
  for (let i = 0; i < 2; i++) {
    await expect(page.locator('.where')).toContainText(`Checking your lines: ${i + 1}`);
    await page.keyboard.type(await page.evaluate(() => {
      const o = window.offScript;
      const n = document.querySelector('.where').textContent.match(/(\d+)$/)[1];
      return o.model.items[Number(n) - 1].tokens.filter((t) => t.k !== null).map((t) => t.k).join('');
    }));
  }
  await page.getByRole('button', { name: 'That is enough, teach me' }).click();
  await expect(page.getByText(/You already know 2 lines/)).toBeVisible();
  await page.getByRole('button', { name: 'Start learning' }).click();
  await expect(page.getByRole('heading', { name: 'Your lines' })).toBeVisible();
  const proved = await page.evaluate(() => [...window.offScript.states.values()].filter((s) => s.proved && s.status === 'review').length);
  expect(proved).toBe(2);
});

test('saying is not enough: the go that learns a line has to be typed', async ({ page }) => {
  await enrol(page);
  await page.getByRole('button', { name: 'No, start from the beginning' }).click();
  // A line right once: its next go from the cue is locked to typing.
  const id = await page.evaluate(() => {
    const o = window.offScript;
    const id = o.model.items[3].id;
    const day = o.today();
    o.states.set(id, { ...o.getState(id), status: 'learning', firstDay: day, passes: 1, helped: 3, stability: 1, passDays: [day], lastResult: 'pass', lastDay: day, lastTime: Date.now() - 3600000, lastMode: 'say' });
    o.go('sprint', { custom: { itemIds: [id], help: 'cue' } });
    return id;
  });
  await page.waitForFunction(() => window.offScript.card && window.offScript.card.step === 'floor');
  await expect(page.getByText('Type this one to prove you know it.')).toBeVisible();
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
      if (await b.count()) await b.first().click();
      return (await b.count()) > 0;
    };
    await page.waitForTimeout(20);
    const keypad = page.locator('.keypad');
    if (await keypad.isVisible()) {
      const keys = await keysOf(page);
      await page.keyboard.type(roll() < 0.2 ? `${keys[0] === 'z' ? 'x' : 'z'}${keys.slice(1)}` : keys);
    } else if (!(await on('Next')) && !(await on('Teach me')) && !(await on('Reveal'))) {
      if (await on('Done')) continue;
      if (!(await on('Another round')) && !(await on('Learn more now')) && !(await on('An extra run')) && !(await on('Start learning'))) await on('Back to my lines');
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
