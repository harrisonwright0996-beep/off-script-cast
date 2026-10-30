import { test, expect, importScript, answerCard } from './helpers.mjs';

test('first run: unlock the invented play, see your lines', async ({ page }) => {
  await importScript(page);
  await expect(page.locator('.ring-num')).toHaveText('0%');
  await expect(page.getByRole('button', { name: 'Start learning' })).toBeVisible();
  await page.screenshot({ path: `shots/${test.info().project.name}-today.png`, fullPage: true });
});
