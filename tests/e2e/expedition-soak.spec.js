import { expect, test } from '@playwright/test';

test.setTimeout(90_000);

test('restarts seeded expedition scenes without stale runtime state', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto('/?mode=expedition&seed=soak&testMode=1&watcher=0&debug=1');
  await page.locator('#title').click();
  await page.locator('#hideout-loadout').click();
  await page.locator('#loadout-deploy').click();
  await expect
    .poll(async () => await page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.().state))
    .toBe('Exploration');

  const samples = [];
  for (let iteration = 0; iteration < 4; iteration += 1) {
    await page.evaluate(() => window.__PEREVAL_DEBUG__?.restartRun?.());
    await page.waitForTimeout(250);
    samples.push(
      await page.evaluate(() => ({
        state: window.__PEREVAL_DEBUG__?.getRunState?.().state,
        modules: window.__PEREVAL_DEBUG__?.getRunState?.().run?.map?.modules?.length,
        renderer: window.__PEREVAL_DEBUG__?.getRendererInfo?.(),
        navMesh: window.__PEREVAL_DEBUG__?.getNavigationMeshState?.(),
        elapsed: window.__PEREVAL_DEBUG__?.getRunState?.().run?.elapsedSeconds,
      })),
    );
  }

  expect(samples).toHaveLength(4);
  expect(samples.every((sample) => sample.state === 'Exploration')).toBe(true);
  expect(samples.every((sample) => sample.modules >= 10 && sample.modules <= 16)).toBe(true);
  expect(samples.every((sample) => Number.isFinite(sample.renderer?.calls))).toBe(true);
  expect(samples.every((sample) => sample.navMesh?.polygonCount === sample.modules * 2)).toBe(true);
  expect(samples.every((sample) => sample.elapsed < 1)).toBe(true);
  const geometryCounts = samples.map((sample) => sample.renderer?.memory?.geometries ?? 0);
  expect(Math.max(...geometryCounts) - Math.min(...geometryCounts)).toBeLessThanOrEqual(2);
  expect(pageErrors).toEqual([]);
});
