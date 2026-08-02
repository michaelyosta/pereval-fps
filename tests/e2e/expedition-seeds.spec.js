import { expect, test } from '@playwright/test';

test.setTimeout(120_000);

const scenarios = [
  ['short-linear', 'pistol'],
  ['underground', 'shotgun'],
  ['high-threat', 'rifle'],
];

for (const [seed, weapon] of scenarios) {
  test(`completes seeded QA run ${seed} with ${weapon}`, async ({ page }) => {
    const startedAt = Date.now();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto(`/?mode=expedition&seed=${seed}&testMode=1&watcher=0&debug=1`);
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
