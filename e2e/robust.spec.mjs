// When things go wrong on a phone: a second tab, a push after everything was removed, an app that will not start.
import { readFileSync } from 'node:fs';
import { test, expect, importScript, open } from './helpers.mjs';

const started = (page) => page.getByRole('button', { name: 'Carry on without installing' }).or(page.getByLabel('Company code'));

async function removeEverything(page) {
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Remove everything' }).click();
  await expect(page.getByRole('heading', { name: 'Remove everything?' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove everything' }).click();
}

test('Remove everything finishes with a second tab open', async ({ page, context }) => {
  await importScript(page);
  const other = await context.newPage();
  await open(other);
  await expect(other.getByRole('heading', { name: 'Your lines', exact: true })).toBeVisible();
  await removeEverything(page);
  await expect(started(page)).toBeVisible();
  expect(await page.evaluate(() => window.offScript.model)).toBeNull();
});

test('a tab that will not let go cannot freeze Remove everything; the delete finishes when it closes', async ({ page, context }) => {
  await importScript(page);
  const other = await context.newPage();
  await other.goto('styles.css');
  await other.evaluate(() => new Promise((resolve) => {
    const db = indexedDB.open('off-script-cast');
    db.onsuccess = () => {
      window.held = db.result; // with no onversionchange, as in a tab still on an older version
      resolve();
    };
  }));
  const reloaded = page.waitForEvent('load');
  await removeEverything(page);
  await reloaded;
  await other.close();
  await expect(started(page)).toBeVisible();
  expect(await page.evaluate(() => [window.offScript.model, window.offScript.manifest, window.offScript.keys])).toEqual([null, null, null]);
});

test('Remove everything still works in a tab whose connection another tab has closed', async ({ page, context }) => {
  await importScript(page);
  const other = await context.newPage();
  await open(other);
  await removeEverything(other);
  await expect(started(other)).toBeVisible();
  await removeEverything(page); // this tab still shows the old screens
  await expect(started(page)).toBeVisible();
  expect(await page.evaluate(() => window.offScript.model)).toBeNull();
});

// The service worker's own code for the words of a reminder, run as it stands in sw.js.
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const nudge = sw.slice(sw.indexOf('const DEFAULT_NUDGE'), sw.indexOf("self.addEventListener('push'"));
const savedNudge = `(() => { ${nudge}; return savedNudge(); })()`;

test('a push after Remove everything uses the plain words and does not make a new database', async ({ page }) => {
  await page.goto('styles.css'); // the same address, with no app open
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  expect(await page.evaluate(savedNudge)).toEqual({ title: 'Off Script', body: 'Your lines are ready when you are. Fancy a quick round?' });
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  // A phone that cannot list its databases falls back on aborting the open. Nothing gets a version.
  await page.evaluate(() => {
    IDBFactory.prototype.real = IDBFactory.prototype.databases;
    delete IDBFactory.prototype.databases;
  });
  expect((await page.evaluate(savedNudge)).title).toBe('Off Script');
  const left = await page.evaluate(() => indexedDB.real());
  expect(left.filter((d) => d.version > 0)).toEqual([]);
});

test('a push reads the saved words and lets go of the database', async ({ page }) => {
  await page.goto('styles.css');
  const words = { title: 'Off Script', body: 'Saved on the phone.' };
  await page.evaluate((words) => new Promise((resolve) => {
    const db = indexedDB.open('off-script-cast', 1);
    db.onupgradeneeded = () => db.result.createObjectStore('kv');
    db.onsuccess = () => {
      const tx = db.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(words, 'reminder');
      tx.oncomplete = () => {
        db.result.close();
        resolve();
      };
    };
  }), words);
  expect(await page.evaluate(savedNudge)).toEqual(words);
  const end = await page.evaluate(() => new Promise((resolve) => {
    const del = indexedDB.deleteDatabase('off-script-cast');
    del.onblocked = () => resolve('blocked');
    del.onsuccess = () => resolve('deleted');
  }));
  expect(end).toBe('deleted');
});

test.describe('the startup watchdog', () => {
  test.use({ serviceWorkers: 'block' }); // so a file can be held back, in WebKit too

  const stuck = (page) => page.getByRole('heading', { name: 'Off Script did not open.' });

  test('an app file that will not load gets a message and a way to try again', async ({ page }) => {
    await page.route('**/src/app.js', (route) => route.abort());
    await page.goto('./');
    await expect(page.getByText('Opening Off Script…')).toBeVisible();
    await expect(stuck(page)).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('alert')).toHaveText('Check your signal and try again. If it keeps happening, this phone may be too old for Off Script. Ask your director.');
    await page.screenshot({ path: `shots/${test.info().project.name}-did-not-open.png` });
    await page.unroute('**/src/app.js');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(started(page)).toBeVisible();
    await page.waitForTimeout(12500);
    await expect(stuck(page)).toHaveCount(0); // once started, it never shows
  });

  test('an app that is only slow still opens, over the message', async ({ page }) => {
    await page.route('**/src/app.js', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 13000));
      await route.continue();
    });
    await page.goto('./', { waitUntil: 'commit' });
    await expect(stuck(page)).toBeVisible({ timeout: 15000 });
    await expect(started(page)).toBeVisible({ timeout: 15000 });
    await expect(stuck(page)).toHaveCount(0);
  });
});
