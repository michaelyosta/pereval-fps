import { expect, test } from '@playwright/test';

test.setTimeout(90_000);

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
  await expect(page.locator('#expedition-lobby')).toBeVisible();
  expect(await page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.().state)).toBe('Hideout');
  await page.locator('#hideout-loadout').click();
  await expect(page.locator('#expedition-loadout-view')).toBeVisible();
  expect(await page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.().state)).toBe('Loadout');
  await page.locator('#loadout-weapon').selectOption('rifle');
  await page.locator('#loadout-deploy').click();
  await page.waitForTimeout(250);
  const snapshot = await page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.());
  expect(snapshot?.state).toBe('Exploration');
  expect(snapshot?.run?.config?.seed?.display).toBe('e2e');
  expect(snapshot?.run?.loadout?.primaryWeapon).toBe('rifle');
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
  await page.locator('#expedition-next').dispatchEvent('click');
  await expect(page.locator('#expedition-lobby')).toBeVisible();
  expect(await page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.().state)).toBe('Hideout');
  await expect(page.locator('#hideout-unlocks')).toContainText('field-clearance');
  await page.locator('#hideout-loadout').click();
  await page.locator('#loadout-deploy').dispatchEvent('click');
  await page.evaluate(() => window.__PEREVAL_DEBUG__?.addTemporarySkill?.('steady-hands'));
  await page.evaluate(() => window.__PEREVAL_DEBUG__?.failRun?.('debug'));
  await expect(page.locator('#expedition-results')).toBeVisible();
  const failed = await page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.());
  expect(failed?.state).toBe('Results');
  expect(failed?.run?.result?.status).toBe('failure');
  expect(failed?.run?.temporarySkills).toEqual([]);
  expect(failed?.campaign?.permanentUnlocks).toContain('field-clearance');
  await page.locator('#expedition-next').dispatchEvent('click');
  await expect(page.locator('#expedition-lobby')).toBeVisible();
  await expect(page.locator('#hideout-unlocks')).toContainText('field-clearance');
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
