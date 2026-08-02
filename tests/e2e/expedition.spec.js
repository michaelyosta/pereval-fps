import { expect, test } from '@playwright/test';

test('starts a seeded expedition run without browser errors', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/?mode=expedition&seed=e2e&testMode=1&watcher=0&debug=1');
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.locator('#title')).toBeVisible();
  await expect(page.locator('#run-seed')).toHaveText('e2e');

  await page.locator('#title').click();
  await page.waitForTimeout(250);
  const snapshot = await page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.());
  expect(snapshot?.state).toBe('Exploration');
  expect(snapshot?.run?.config?.seed?.display).toBe('e2e');
  expect(snapshot?.run?.map?.modules?.length).toBeGreaterThanOrEqual(10);
  expect(snapshot?.run?.map?.modules?.length).toBeLessThanOrEqual(16);
  expect(await page.locator('#debug-run-state').textContent()).toBe('Exploration');
  const objective = await page.evaluate(() => window.__PEREVAL_DEBUG__?.completeObjective?.());
  expect(objective?.completed).toBe(true);
  expect(await page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.().state)).toBe(
    'ExtractionAvailable',
  );
  await page.evaluate(() => window.__PEREVAL_DEBUG__?.startExtraction?.());
  await page.evaluate(() => window.__PEREVAL_DEBUG__?.tickExtraction?.(3, true));
  expect(await page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.().state)).toBe('Results');
  await expect(page.locator('#expedition-results')).toBeVisible();
  await expect(page.locator('#expedition-result-seed')).toHaveText('e2e');
  await page.screenshot({ path: 'docs/qa/expedition/seed-e2e.png' });
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
