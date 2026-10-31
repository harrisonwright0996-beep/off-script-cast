// Accessibility: axe on every screen, in every theme. No serious or critical problems allowed.
import { createRequire } from 'node:module';
import { test, expect, importScript, answerCard, keysOf, seedOnce } from './helpers.mjs';

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
test.use({ bypassCSP: true }); // only so axe itself can be added to the page

async function check(page, where, found) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: AXE });
  const result = await page.evaluate(() =>
    window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }),
  );
  for (const v of result.violations) {
    found.push({ where, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) });
  }
}

for (const theme of ['stage', 'cream', 'light', 'dark']) {
  test(`every screen in the ${theme} theme`, async ({ page }) => {
    const found = [];
    await page.goto('./');
    await check(page, 'first screen', found);
    await importScript(page);
    await page.evaluate((t) => window.offScript.saveSettings({ theme: t }), theme);
    await page.evaluate(() => window.offScript.go('today'));
    await check(page, 'today', found);

    // The second line's cue made longer, as uniqueCues does for a cue that leads to more than one line
    // (the invented play has none), so a long cue is checked too.
    await page.evaluate(() => {
      const [first, second] = window.offScript.model.items;
      const lines = [{ speaker: first.cue.speaker, text: first.cue.text }, { speaker: first.speaker, text: first.text }];
      window.offScript.index.cues.set(second.id, { ...second.cue, lead: [first.id], lines, nth: 2 });
    });
    await page.getByRole('button', { name: 'Start learning' }).click();
    await page.waitForFunction(() => window.offScript.card);
    await check(page, 'card: test', found);
    await page.getByRole('button', { name: 'Try it' }).click();
    await check(page, 'card: who speaks', found);
    await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: 'Keeper', exact: true }).click();
    await check(page, 'card: keypad', found);
    await page.keyboard.type('?zz');
    await check(page, 'card: typing', found);
    await page.keyboard.type('zzzzzzzzzz');
    await expect(page.locator('.result')).toBeVisible();
    await check(page, 'card: result', found);
    await page.getByRole('button', { name: 'Next', exact: true }).click(); // a missed try is taught: read it
    await check(page, 'card: front', found);
    await page.getByRole('button', { name: 'Next', exact: true }).click(); // then up the ladder
    await expect(page.locator('.line .blank').first()).toBeVisible();
    await check(page, 'card: gaps', found);
    await page.getByRole('button', { name: 'Reveal' }).click();
    await check(page, 'card: gaps revealed', found);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    const nextLine = page.getByText('The second time these lines come in the scene.');
    for (let i = 0; i < 6 && !(await nextLine.count()); i++) await answerCard(page);
    await expect(nextLine).toBeVisible();
    await check(page, 'card: a longer cue', found);
    await page.getByRole('button', { name: 'Try it' }).click();
    await page.getByRole('button', { name: 'Say it instead' }).click();
    await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: 'Keeper', exact: true }).click();
    await check(page, 'card: say before reveal', found);
    await page.getByRole('button', { name: 'Reveal' }).click();
    await check(page, 'card: say', found);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    // Up the ladder, then a line comes back with the first letters.
    const back = () => page.evaluate(() => window.offScript.card.queue === 'beat' && window.offScript.card.step === 'help');
    for (let i = 0; i < 30 && !(await back()); i++) await answerCard(page);
    await check(page, 'card: first letters', found);
    await page.getByRole('button', { name: 'Reveal' }).click();
    await check(page, 'card: first letters revealed', found);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('It comes back later without the first letters.')).toBeVisible();
    await check(page, 'card: first letters result', found);
    await page.getByRole('button', { name: 'Stop' }).click();

    await page.getByRole('button', { name: 'Choose' }).click();
    await expect(page.getByRole('heading', { name: 'Choose' })).toBeVisible(); // drawn once any saved practice is read
    await check(page, 'choose', found);
    await page.getByLabel('Which lines').selectOption({ label: 'Every line' });
    await check(page, 'choose: every line', found);
    await page.getByRole('button', { name: 'Your lines', exact: true }).click();
    await page.getByRole('button', { name: 'Run through' }).click();
    await expect(page.getByRole('heading', { name: 'Run through' })).toBeVisible();
    await check(page, 'run through', found);
    await page.getByRole('button', { name: 'Your lines', exact: true }).click();

    await page.getByRole('button', { name: 'Read my lines' }).click();
    await check(page, 'scenes', found);
    await page.getByRole('button', { name: /Scene 1: The Harbour/ }).click();
    await check(page, 'reader', found);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Your lines', exact: true }).click();

    await page.getByRole('button', { name: 'Settings' }).click();
    await check(page, 'settings', found);
    await page.getByRole('button', { name: 'Start again from 0%' }).click();
    await check(page, 'start again', found);
    await page.getByRole('button', { name: 'Keep my progress' }).click();
    await page.evaluate(() => window.offScript.go('again', { scene: 0 }));
    await check(page, 'start this scene again', found);
    await page.getByRole('button', { name: 'Keep its progress' }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Your lines', exact: true }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Remove everything' }).click();
    await check(page, 'remove everything', found);
    await page.getByRole('button', { name: 'Keep everything' }).click();
    await page.getByRole('button', { name: 'Your lines', exact: true }).click();

    await page.getByRole('button', { name: 'Walk' }).click();
    await check(page, 'walk', found);
    await page.getByRole('button', { name: '15 minutes' }).click();
    await page.getByRole('button', { name: 'End walk' }).waitFor();
    await check(page, 'walk: reading aloud', found);


    for (const f of found) console.log(`${theme} | ${f.where} | ${f.impact} | ${f.id}: ${f.help} | ${f.nodes.join(', ')}`);
    expect(found.filter((f) => f.impact === 'serious' || f.impact === 'critical')).toEqual([]);
  });
}

for (const theme of ['stage', 'cream', 'light', 'dark']) {
  test(`a slip of the finger and a word missed before, in the ${theme} theme`, async ({ page }) => {
    const found = [];
    await importScript(page);
    await page.evaluate((t) => window.offScript.saveSettings({ theme: t }), theme);
    await page.evaluate(() => window.offScript.go('today'));
    await page.getByRole('button', { name: 'Start learning' }).click();
    await page.getByRole('button', { name: 'Try it' }).click();
    await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: 'Cast', exact: true }).click();
    const keys = await keysOf(page);
    // Its first word was missed in this line once before, as if on an earlier day.
    await page.evaluate(() => window.offScript.events.push({ time: Date.now() - 86400000, day: '2026-10-25', id: window.offScript.card.item.id, pass: false, mode: 'type', misses: 1, missed: [0] }));
    await page.keyboard.type('e' + keys.slice(1)); // e touches w
    await expect(page.getByRole('button', { name: 'A slip of the finger? Count it right' })).toBeVisible();
    await expect(page.getByText('Tricky words for you: We.')).toBeVisible();
    await check(page, 'card: a slip, missed before', found);
    await page.getByRole('button', { name: 'A slip of the finger? Count it right' }).click();
    await expect(page.locator('.result.perfect')).toHaveText(/Counted right: a slip of the finger/);
    await check(page, 'card: counted right', found);
    for (const f of found) console.log(`${theme} | ${f.where} | ${f.impact} | ${f.id}: ${f.help} | ${f.nodes.join(', ')}`);
    expect(found.filter((f) => f.impact === 'serious' || f.impact === 'critical')).toEqual([]);
  });
}

test('a first letters card with blanks, in every theme', async ({ page }) => {
  const found = [];
  await importScript(page);
  const id = await page.evaluate(() => window.offScript.model.items.find((x) => x.words >= 8).id);
  for (const theme of ['stage', 'cream', 'light', 'dark']) {
    await page.evaluate((t) => window.offScript.saveSettings({ theme: t }), theme);
    await seedOnce(page, id);
    await check(page, `card: fewer first letters (${theme})`, found);
  }
  expect(found.filter((f) => f.impact === 'serious' || f.impact === 'critical')).toEqual([]);
});

// axe leaves out disabled controls and cannot judge a dot, so these are measured here.
const contrast = (page, read) =>
  page.evaluate((read) => {
    const rgb = (c) => c.match(/[\d.]+/g).map(Number);
    const lum = ([r, g, b]) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const css = (el, key) => getComputedStyle(document.querySelector(el))[key];
    const [a, b] = read === 'start' ? [css('.foot .btn[disabled]', 'color'), css('.foot .btn[disabled]', 'backgroundColor')] : [css('.lamp', 'borderTopColor'), css('.light', 'backgroundColor')];
    const [hi, lo] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }, read);

test('a disabled Start can be read, and an unlit scene dot can be seen, in every theme', async ({ page }) => {
  await importScript(page);
  for (const theme of ['stage', 'cream', 'light', 'dark']) {
    await page.evaluate((t) => window.offScript.saveSettings({ theme: t }), theme);
    await page.evaluate(() => window.offScript.go('today'));
    await expect(page.locator('.light-pc').first()).toHaveText('0%');
    expect(await contrast(page, 'dot'), `dot in ${theme}`).toBeGreaterThanOrEqual(3);
    await page.getByRole('button', { name: 'Choose' }).click();
    await page.getByLabel('Which lines').selectOption({ label: 'Lines still being learnt' });
    await expect(page.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(await contrast(page, 'start'), `Start in ${theme}`).toBeGreaterThanOrEqual(4.5);
  }
});
