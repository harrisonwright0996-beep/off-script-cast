import { test, expect, importScript, importPack } from './helpers.mjs';

const shot = (page, name) => page.screenshot({ path: `shots/${test.info().project.name}-${name}.png` });

test('audio pack: import, build a walk tape that can play, mark a line, review and save', async ({ page }) => {
  await importScript(page);
  await importPack(page);
  await page.getByRole('button', { name: 'Walk' }).click();
  await expect(page.getByText('keep one earbud out', { exact: false })).toBeVisible();
  await expect(page.getByText('New line: just listen, then say it back when you are told.')).toBeVisible();
  await shot(page, 'walk-choose');
  await page.getByRole('button', { name: '15 minutes' }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.waitForFunction(() => window.offScript.walk && window.offScript.walk.player.audio.readyState >= 3, null, { timeout: 15000 });
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await shot(page, 'walk-playing');
  // Jump to just after the fourth answer, as if the walk had got that far, and mark it.
  const t = await page.evaluate(() => {
    const { tape, player } = window.offScript.walk;
    const at = tape.trials[3].answerEnd + 0.5;
    player.seek(at);
    return at;
  });
  await page.waitForFunction((at) => Math.abs(window.offScript.walk.player.time - at) < 0.5, t);
  await page.getByRole('button', { name: 'Missed that one' }).click();
  await expect(page.getByText('1 line marked as missed.')).toBeVisible();
  await page.getByRole('button', { name: 'End walk' }).click();
  await expect(page.getByRole('heading', { name: 'How did it go?' })).toBeVisible();
  await expect(page.locator('.review-list input:checked')).toHaveCount(1);
  await shot(page, 'walk-review');
  await page.getByRole('button', { name: 'Save my walk' }).click();
  await expect(page.getByRole('heading', { name: 'Walk saved' })).toBeVisible();
  const saved = await page.evaluate(() => window.offScript.events.filter((e) => e.mode === 'walk').map((e) => e.pass));
  expect(saved.length).toBe(4);
  expect(saved.filter((p) => !p).length).toBe(1);
  await page.getByRole('button', { name: 'Another 15 minutes' }).click(); // the same length again, in one tap
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
});

test('without an audio pack, Walk reads aloud with the screen on', async ({ page }) => {
  await importScript(page);
  await page.evaluate(() => (window.offScript.manifest = null)); // a pack that could not be read
  await page.getByRole('button', { name: 'Walk' }).click();
  await expect(page.getByText('Tap Missed. Keep the screen on.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '15 minutes' }).click();
  await expect(page.getByRole('button', { name: 'Missed', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Got it' })).toBeVisible();
  await page.getByRole('button', { name: 'End walk' }).click();
  await expect(page.getByRole('heading', { name: 'Walk ended' })).toBeVisible();
});

// The walk screen, ready to play: 15 minutes unless told otherwise.
async function startWalk(page, length = '15 minutes') {
  await importScript(page);
  await importPack(page);
  await page.getByRole('button', { name: 'Walk' }).click();
  await page.getByRole('button', { name: length, exact: true }).click();
  await page.waitForFunction(() => window.offScript.walk && window.offScript.walk.player.audio.readyState >= 3, null, { timeout: 15000 });
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
}

// Jumps the tape to the moment fn gives, as if the walk had got that far.
async function jump(page, fn) {
  const at = await page.evaluate(`(() => { const { tape, player } = window.offScript.walk; const at = (${fn})(tape); player.seek(at); return at; })()`);
  await page.waitForFunction((t) => Math.abs(window.offScript.walk.player.time - t) < 0.5, at);
  return at;
}

test('a line being taught: Missed that one counts it as needing help, Hear it again goes back to it', async ({ page }) => {
  await startWalk(page);
  await page.evaluate(() => window.offScript.walk.player.pause());
  await jump(page, (tape) => tape.teaching[0].start + 3);
  await page.getByRole('button', { name: 'Hear it again' }).click();
  await page.waitForFunction(() => {
    const { tape, player } = window.offScript.walk;
    return Math.abs(player.time - tape.teaching[0].start) < 0.5;
  });
  await jump(page, (tape) => tape.teaching[0].start + 3);
  await page.getByRole('button', { name: 'Missed that one' }).click();
  await expect(page.getByText('1 line marked as missed.')).toBeVisible();
  await page.getByRole('button', { name: 'End walk' }).click();
  await expect(page.getByRole('heading', { name: 'How did it go?' })).toBeVisible();
  await expect(page.locator('.review-list input:checked')).toHaveCount(1);
  await page.getByRole('button', { name: 'Save my walk' }).click();
  await expect(page.getByText('Your practice counts when you next type them.')).toBeVisible();
  const state = await page.evaluate(() => {
    const o = window.offScript;
    const ev = o.events.filter((e) => e.mode === 'walk');
    return { n: ev.length, pass: ev[0].pass, passes: o.getState(ev[0].id).passes };
  });
  expect(state).toEqual({ n: 1, pass: false, passes: 0 });
});

test('a mark made in a gap reaches the review, and the count agrees with it', async ({ page }) => {
  await startWalk(page);
  await jump(page, (tape) => tape.trials[1].answerEnd + 0.5);
  await page.getByRole('button', { name: 'Missed that one' }).click();
  await expect(page.getByText('1 line marked as missed.')).toBeVisible();
  await jump(page, (tape) => tape.trials[2].start + 0.5);
  await page.getByRole('button', { name: 'Missed that one' }).click();
  await expect(page.getByText('2 lines marked as missed.')).toBeVisible();
  await page.getByRole('button', { name: 'End walk' }).click();
  await expect(page.locator('.review-list input:checked')).toHaveCount(2);
});

test('after a pause the tape picks up from the line\'s cue, not in the middle of its gap', async ({ page }) => {
  await startWalk(page);
  await jump(page, (tape) => tape.trials[1].start + 0.6);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForFunction(() => {
    const { tape, player } = window.offScript.walk;
    return player.time < tape.trials[1].start && player.time >= tape.trials[1].replayFrom - 0.1;
  });
});

test('the tape ends and the page is lost: the walk comes back into its review, once', async ({ page }) => {
  await startWalk(page, '5 minutes');
  await jump(page, (tape) => tape.trials[0].answerEnd + 0.5);
  await page.getByRole('button', { name: 'Missed that one' }).click();
  await expect(page.getByText('1 line marked as missed.')).toBeVisible();
  const rows = await page.evaluate(() => new Set(window.offScript.walk.tape.trials.map((t) => t.id)).size);
  await jump(page, (tape) => tape.duration - 0.5);
  await expect(page.getByRole('heading', { name: 'How did it go?' })).toBeVisible();
  await page.waitForFunction(() => window.offScript.store.get('walkDraft'));
  await page.reload(); // the phone clears the page
  await page.getByRole('button', { name: 'Walk' }).click();
  await expect(page.getByRole('heading', { name: 'How did it go?' })).toBeVisible();
  await expect(page.getByText('Here is your last walk.', { exact: false })).toBeVisible();
  await expect(page.locator('.review-list li')).toHaveCount(rows);
  await expect(page.locator('.review-list input:checked')).toHaveCount(1);
  await page.getByRole('button', { name: 'Save my walk' }).click();
  await expect(page.getByRole('heading', { name: 'Walk saved' })).toBeVisible();
  expect(await page.evaluate(() => window.offScript.store.get('walkDraft'))).toBeUndefined();
  expect(await page.evaluate(() => window.offScript.events.filter((e) => e.mode === 'walk' && !e.pass).length)).toBe(1);
  await page.getByRole('button', { name: 'A different length' }).click();
  await expect(page.getByRole('heading', { name: 'How long?' })).toBeVisible();
});

test('let go of a kept walk and it does not come back', async ({ page }) => {
  await startWalk(page, '5 minutes');
  await jump(page, (tape) => tape.duration - 0.5);
  await expect(page.getByRole('heading', { name: 'How did it go?' })).toBeVisible();
  await page.getByRole('button', { name: 'Don’t count this one' }).click();
  await expect(page.getByRole('heading', { name: 'Your lines' })).toBeVisible();
  await page.getByRole('button', { name: 'Walk' }).click();
  await expect(page.getByRole('heading', { name: 'How long?' })).toBeVisible();
});

test('ending a walk before the first go says so kindly, and nothing is kept', async ({ page }) => {
  await startWalk(page);
  await page.getByRole('button', { name: 'End walk' }).click();
  await expect(page.getByRole('heading', { name: 'Walk ended' })).toBeVisible();
  await expect(page.getByText('You stopped before your first go at a line', { exact: false })).toBeVisible();
  await expect(page.getByText('Nothing was heard', { exact: false })).toHaveCount(0);
});

test('the walk steps say to stop before looking, and how to hear a line again', async ({ page }) => {
  await importScript(page);
  await page.getByRole('button', { name: 'Walk' }).click();
  await expect(page.getByText('Stop walking before you look at your phone.')).toBeVisible();
  await expect(page.getByText('Press back on your earbuds, or tap Hear it again.', { exact: false })).toBeVisible();
});

test('a line the walk only left as all good is taught in the next round, not a locked check', async ({ page }) => {
  await startWalk(page);
  await jump(page, (tape) => tape.trials[3].answerEnd + 0.5);
  await page.getByRole('button', { name: 'End walk' }).click();
  await page.getByRole('button', { name: 'Save my walk' }).click();
  await expect(page.getByRole('heading', { name: 'Walk saved' })).toBeVisible();
  await expect(page.getByText('all word perfect', { exact: false })).toHaveCount(0);
  const states = await page.evaluate(() => {
    const o = window.offScript;
    return [...new Set(o.events.map((e) => e.id))].map((id) => o.getState(id)).map((s) => [s.status, s.passes]);
  });
  expect(states.every(([status, passes]) => status === 'learning' && passes === 0)).toBe(true);
  await page.evaluate(() => window.offScript.go('sprint'));
  await page.waitForFunction(() => window.offScript.card);
  expect(await page.evaluate(() => window.offScript.card.step)).toBe('front'); // read it first: being taught
});
