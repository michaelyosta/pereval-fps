import { expect, test } from '@playwright/test';

test.setTimeout(120_000);

const scenarios = [
  ['short-linear', 'pistol', 0],
  ['branching', 'rifle', 0],
  ['underground', 'shotgun', 0],
  ['weapon-cache', 'oblomok-7', 0],
  ['watcher', 'rifle', 1],
  ['high-threat', 'oblomok-7', 1],
  ['low-loot', 'pistol', 0],
  ['rich-loot', 'shotgun', 0],
];

for (const [seed, weapon, watcher] of scenarios) {
  test(`completes seeded QA run ${seed} with ${weapon}`, async ({ page }) => {
    const startedAt = Date.now();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto(`/?mode=expedition&seed=${seed}&testMode=1&watcher=${watcher}&debug=1`);
    await page.locator('#title').click();
    await page.locator('#hideout-loadout').click();
    await page.locator('#loadout-weapon').selectOption(weapon);
    await page.locator('#loadout-deploy').dispatchEvent('click');
    await expect
      .poll(async () => page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.().state))
      .toBe('Exploration');
    const before = await page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.());
    expect(before?.run?.map?.modules?.length).toBeGreaterThanOrEqual(10);
    expect(before?.run?.config?.seed?.display).toBe(seed);
    await page.screenshot({ path: `docs/qa/expedition/seeds/${seed}.png`, fullPage: true });
    if (watcher) {
      await page.evaluate(() => {
        window.__PEREVAL_DEBUG__?.recordNoise?.({ kind: 'shot', intensity: 4, duration: 2 });
        window.__PEREVAL_DEBUG__?.tickRun?.(0.2);
      });
      const watcherState = await page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.().run?.watcher);
      expect(watcherState?.state).toBe('stalking');
      expect(watcherState?.candidateId).toBeTruthy();
    }

    await page.evaluate(() => window.__PEREVAL_DEBUG__?.completeObjective?.());
    const skillId = await page.evaluate(
      () => window.__PEREVAL_DEBUG__?.getRunState?.().run?.skillOptions?.[0]?.id,
    );
    await page.evaluate((id) => window.__PEREVAL_DEBUG__?.chooseSkill?.(id), skillId);
    await page.evaluate(() => window.__PEREVAL_DEBUG__?.startExtraction?.());
    await page.evaluate(() => window.__PEREVAL_DEBUG__?.tickExtraction?.(3, true));
    await expect
      .poll(async () => page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.().state))
      .toBe('Results');

    const result = await page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.().run?.result);
    console.log(JSON.stringify({ seed, weapon, elapsedMs: Date.now() - startedAt, result }));
    expect(result?.status).toBe('success');
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}
