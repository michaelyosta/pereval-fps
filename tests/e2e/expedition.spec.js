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
  const navigationMesh = await page.evaluate(() => window.__PEREVAL_DEBUG__?.getNavigationMeshState?.());
  expect(navigationMesh?.nodeCount).toBe(snapshot?.run?.map?.modules?.length);
  expect(navigationMesh?.polygonCount).toBe(navigationMesh?.regionCount * 2);
  expect(navigationMesh?.obstacleCount).toBeGreaterThan(0);
  expect(await page.locator('#debug-run-state').textContent()).toBe('Exploration');
  const objective = await page.evaluate(() => window.__PEREVAL_DEBUG__?.completeObjective?.());
  expect(objective?.completed).toBe(true);
  expect(await page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.().state)).toBe(
    'ExtractionAvailable',
  );
  const skillId = await page.evaluate(
    () => window.__PEREVAL_DEBUG__?.getRunState?.().run?.skillOptions?.[0]?.id,
  );
  expect(skillId).toBeTruthy();
  await page.evaluate((id) => window.__PEREVAL_DEBUG__?.chooseSkill?.(id), skillId);
  expect(
    await page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.().run?.temporarySkills?.length),
  ).toBe(1);
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
  await expect(page.locator('#hideout-history-list')).toContainText('SUCCESS');
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
  await expect(page.locator('#hideout-history-list')).toContainText('FAILED');
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('spawns a safe deterministic mid-run encounter after pressure rises', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/?mode=expedition&seed=encounter-e2e&testMode=1&watcher=0&debug=1');
  await page.locator('#title').click();
  await page.locator('#hideout-loadout').click();
  await page.locator('#loadout-deploy').click();
  await page.waitForTimeout(300);

  const initialBots = await page.evaluate(() => window.__PEREVAL_DEBUG__?.getBotState?.());
  expect(initialBots?.length).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  const navigatingBots = await page.evaluate(() => window.__PEREVAL_DEBUG__?.getBotState?.());
  expect(
    navigatingBots?.some(
      (bot) =>
        (bot.navigation?.nodes?.length ?? 0) > 1 && Number.isInteger(bot.navigation?.localWaypointIndex),
    ),
  ).toBe(true);
  for (let index = 0; index < 3; index += 1)
    await page.evaluate(() => window.__PEREVAL_DEBUG__?.killNearestEnemy?.());
  await page.evaluate(() => {
    for (let index = 0; index < 12; index += 1)
      window.__PEREVAL_DEBUG__?.recordNoise?.({ kind: 'shot', intensity: 3, duration: 2 });
  });
  await page.evaluate(() => window.__PEREVAL_DEBUG__?.tickRun?.(2.2));

  const encounter = await page.evaluate(() => window.__PEREVAL_DEBUG__?.getEncounterState?.());
  const currentBots = await page.evaluate(() => window.__PEREVAL_DEBUG__?.getBotState?.());
  const requested = encounter?.recentEvents?.find((event) => event.type === 'encounter-requested');
  expect(requested).toMatchObject({ type: 'encounter-requested', groupId: expect.any(String) });
  expect(encounter?.groups?.find((group) => group.id === requested.groupId)?.state).toBe('spawned');
  expect(currentBots?.some((bot) => bot.groupId === requested.groupId)).toBe(true);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('survives a virtual twenty-minute normal-mode duration soak', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/?mode=expedition&seed=normal-duration&watcher=1&debug=1');
  await page.locator('#title').click();
  await page.locator('#hideout-loadout').click();
  await page.locator('#loadout-deploy').click();
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    for (let step = 0; step < 120; step += 1) {
      if (step % 20 === 0)
        window.__PEREVAL_DEBUG__?.recordNoise?.({ kind: 'shot', intensity: 3, duration: 2 });
      window.__PEREVAL_DEBUG__?.tickRun?.(10);
    }
  });

  const snapshot = await page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.());
  const encounter = await page.evaluate(() => window.__PEREVAL_DEBUG__?.getEncounterState?.());
  expect(snapshot?.state).toBe('Exploration');
  expect(snapshot?.run?.elapsedSeconds).toBeGreaterThanOrEqual(1200);
  expect(snapshot?.run?.elapsedSeconds).toBeLessThan(1201);
  expect(snapshot?.run?.threat).toBeGreaterThanOrEqual(0);
  expect(snapshot?.run?.threat).toBeLessThanOrEqual(100);
  expect(snapshot?.run?.anomaly).toBeGreaterThanOrEqual(0);
  expect(snapshot?.run?.anomaly).toBeLessThanOrEqual(100);
  expect(encounter?.groups?.filter((group) => group.state === 'spawned').length).toBeGreaterThan(0);
  expect(encounter?.groups?.filter((group) => group.state === 'pending').length).toBe(0);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('completes a normal-mode balance profile with the full extraction duration', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/?mode=expedition&seed=normal-profile&watcher=1&debug=1');
  await page.locator('#title').click();
  await page.locator('#hideout-loadout').click();
  await page.locator('#loadout-deploy').click();
  await page.waitForTimeout(250);

  await page.evaluate(() => {
    for (let step = 0; step < 80; step += 1) {
      if (step % 10 === 0)
        window.__PEREVAL_DEBUG__?.recordNoise?.({ kind: 'shot', intensity: 2.5, duration: 2 });
      window.__PEREVAL_DEBUG__?.tickRun?.(15);
    }
  });
  const beforeObjective = await page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.());
  expect(beforeObjective?.state).toBe('Exploration');
  expect(beforeObjective?.run?.elapsedSeconds).toBeGreaterThanOrEqual(1200);
  expect(beforeObjective?.run?.threat).toBeLessThanOrEqual(100);
  expect(beforeObjective?.run?.anomaly).toBeLessThanOrEqual(100);

  await page.evaluate(() => window.__PEREVAL_DEBUG__?.completeObjective?.());
  const skillId = await page.evaluate(
    () => window.__PEREVAL_DEBUG__?.getRunState?.().run?.skillOptions?.[0]?.id,
  );
  await page.evaluate((id) => window.__PEREVAL_DEBUG__?.chooseSkill?.(id), skillId);
  await page.evaluate(() => window.__PEREVAL_DEBUG__?.startExtraction?.());
  expect(await page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.().run?.extraction?.duration)).toBe(
    30,
  );
  await page.evaluate(() => window.__PEREVAL_DEBUG__?.tickRun?.(29, true));
  expect(await page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.().state)).toBe('Extracting');
  expect(
    await page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.().run?.extraction?.progress),
  ).toBeGreaterThanOrEqual(28);
  await page.evaluate(() => window.__PEREVAL_DEBUG__?.tickRun?.(2, true));
  const result = await page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.().run?.result);
  expect(result?.status).toBe('success');
  expect(result?.elapsedSeconds).toBeGreaterThanOrEqual(1230);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('completes three normal-mode seeded balance profiles', async ({ page }) => {
  test.setTimeout(180_000);
  const scenarios = [
    ['balance-fast', 'pistol', 0],
    ['balance-optional', 'shotgun', 1],
    ['balance-watcher', 'rifle', 1],
  ];
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const profiles = [];

  for (const [seed, weapon, watcher] of scenarios) {
    await page.goto(`/?mode=expedition&seed=${seed}&watcher=${watcher}&debug=1`);
    await page.locator('#title').click();
    await page.locator('#hideout-loadout').click();
    await page.locator('#loadout-weapon').selectOption(weapon);
    await page.locator('#loadout-deploy').click();
    await expect
      .poll(async () => page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.().state))
      .toBe('Exploration');
    await page.evaluate(() => {
      for (let step = 0; step < 80; step += 1) {
        if (step % 10 === 0)
          window.__PEREVAL_DEBUG__?.recordNoise?.({ kind: 'shot', intensity: 2.5, duration: 2 });
        window.__PEREVAL_DEBUG__?.tickRun?.(15);
      }
    });
    const beforeObjective = await page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.());
    expect(beforeObjective?.state).toBe('Exploration');
    expect(beforeObjective?.run?.elapsedSeconds).toBeGreaterThanOrEqual(1200);
    await page.evaluate(() => window.__PEREVAL_DEBUG__?.completeObjective?.());
    const skillId = await page.evaluate(
      () => window.__PEREVAL_DEBUG__?.getRunState?.().run?.skillOptions?.[0]?.id,
    );
    await page.evaluate((id) => window.__PEREVAL_DEBUG__?.chooseSkill?.(id), skillId);
    await page.evaluate(() => window.__PEREVAL_DEBUG__?.startExtraction?.());
    await page.evaluate(() => window.__PEREVAL_DEBUG__?.tickRun?.(31, true));
    const result = await page.evaluate(() => window.__PEREVAL_DEBUG__?.getRunState?.().run?.result);
    profiles.push({
      seed,
      weapon,
      watcher,
      elapsedSeconds: result?.elapsedSeconds,
      status: result?.status,
      objective: result?.stats?.objectivesCompleted,
    });
    expect(result?.status).toBe('success');
    expect(result?.elapsedSeconds).toBeGreaterThanOrEqual(1230);
  }

  console.log(JSON.stringify({ type: 'normal-balance-profiles', profiles }));
  expect(profiles).toHaveLength(3);
  expect(new Set(profiles.map((profile) => profile.seed)).size).toBe(3);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
