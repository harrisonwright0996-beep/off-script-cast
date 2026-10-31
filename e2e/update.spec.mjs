// A new version arriving on a phone that is in use, on a server of its own whose sw.js can change.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, enrol, answerCard } from './helpers.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

async function site(port, version) {
  const live = { version };
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    try {
      let body = await readFile(join(root, path === '/' ? 'index.html' : path));
      if (path === '/sw.js') body = body.toString().replace(/const VERSION = '[^']*'/, `const VERSION = '${live.version}'`);
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'text/html', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((done) => server.listen(port, done));
  live.close = () => new Promise((done) => server.close(done));
  return live;
}

const newRelease = (page, live, version = 'test-next') => {
  live.version = version;
  return page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
};
const ready = (page, live) => expect(async () => expect(await page.evaluate(() => caches.keys())).toEqual([live.version])).toPass();
const steady = async (page) => {
  await expect(async () => expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)).toPass();
  await page.evaluate(() => (window.samePage = true));
};

test.describe('updates', () => {
  let live;
  let url;
  test.beforeEach(async ({ page }, info) => {
    const port = 4400 + info.parallelIndex * 2 + (info.project.name === 'webkit' ? 0 : 1);
    live = await site(port, info.title.startsWith('an older') ? 'off-script-cast-15' : 'test-first');
    url = `http://localhost:${port}/`;
    await enrol(page, 'Whole Company', url);
    await page.getByRole('button', { name: 'No, start from the beginning' }).click();
    await expect(page.getByRole('heading', { name: 'Your lines' })).toBeVisible();
    await steady(page);
  });
  test.afterEach(() => live.close());

  test('on Your lines a new version starts by itself, and nothing is lost', async ({ page }) => {
    const before = await page.evaluate(() => window.offScript.model.items.length);
    await newRelease(page, live);
    await expect(async () => expect(await page.evaluate(() => !window.samePage)).toBe(true)).toPass();
    await expect(page.getByRole('heading', { name: 'Your lines' })).toBeVisible();
    await ready(page, live);
    expect(await page.evaluate(() => window.offScript.model.items.length)).toBe(before);
    await expect(page.getByText('A new version')).toHaveCount(0);
  });

  test('a round goes on undisturbed, and the new version starts back at Your lines', async ({ page }) => {
    await page.getByRole('button', { name: 'Start learning' }).click();
    await answerCard(page);
    await newRelease(page, live);
    await ready(page, live);
    await answerCard(page);
    await answerCard(page);
    expect(await page.evaluate(() => window.samePage)).toBe(true);
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(async () => expect(await page.evaluate(() => !window.samePage)).toBe(true)).toPass();
    await expect(page.getByRole('heading', { name: 'Your lines' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next round' })).toBeVisible();
  });

  test('it starts by itself on More too, and on leaving a round for a scene', async ({ page }) => {
    await page.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('heading', { name: 'More' })).toBeVisible();
    await newRelease(page, live);
    await expect(async () => expect(await page.evaluate(() => !window.samePage)).toBe(true)).toPass();
    await expect(page.getByRole('heading', { name: 'Your lines' })).toBeVisible();
    await steady(page);
    await page.getByRole('button', { name: 'Next round' }).or(page.getByRole('button', { name: 'Start learning' })).click();
    await newRelease(page, live, 'test-after');
    await ready(page, live);
    expect(await page.evaluate(() => window.samePage)).toBe(true);
    await page.evaluate(() => window.offScript.go('scenes'));
    await expect(async () => expect(await page.evaluate(() => !window.samePage)).toBe(true)).toPass();
  });

  test('an older version that cannot start again by itself is sent to the new one, even in a round', async ({ page }) => {
    await page.getByRole('button', { name: 'Start learning' }).click();
    await answerCard(page);
    await newRelease(page, live, 'off-script-cast-17');
    await expect(async () => expect(await page.evaluate(() => !window.samePage)).toBe(true)).toPass();
    await expect(page.getByRole('heading', { name: 'Your lines' })).toBeVisible();
    await ready(page, live);
  });

  test('an older version with a walk under way is left to finish it', async ({ page }) => {
    await page.evaluate(() => window.offScript.store.set('walkDraft', { trials: [] }));
    await page.evaluate(() => window.offScript.go('settings'));
    await newRelease(page, live, 'off-script-cast-17');
    await ready(page, live);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.samePage)).toBe(true);
  });
});
