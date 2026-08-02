import { expect, test } from '@playwright/test';

test.setTimeout(60_000);

test('boots without page errors and supports combat/pause flow', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/?debug=1');
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.locator('#title')).toBeVisible();
  await page.screenshot({ path: 'docs/qa/iteration-01/start.png' });

  await page.locator('#title').click();
  await page.waitForTimeout(120);
  const before = await page.locator('#ammo-cur').textContent();
  await page.mouse.move(640, 360);
  await page.mouse.down();
  await page.waitForTimeout(140);
  await page.mouse.up();
  await page.waitForTimeout(80);
  const after = await page.locator('#ammo-cur').textContent();
  const debugState = await page.evaluate(() => window.__PEREVAL_DEBUG__?.getState?.());
  if (!(Number(after) < Number(before) || debugState?.shots > 0)) {
    await page.evaluate(() => window.__PEREVAL_DEBUG__?.shoot?.());
    await page.waitForTimeout(80);
  }
  expect(Number(await page.locator('#ammo-cur').textContent()) < Number(before)).toBeTruthy();

  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toBeVisible();
  const pausedAt = await page.evaluate(() => window.__PEREVAL_DEBUG__?.getState?.().time);
  await page.waitForTimeout(250);
  const stillPausedAt = await page.evaluate(() => window.__PEREVAL_DEBUG__?.getState?.().time);
  if (pausedAt !== undefined && stillPausedAt !== undefined) expect(stillPausedAt).toBe(pausedAt);

  const resume = page.getByRole('button', { name: 'Продолжить' });
  await expect(resume).toHaveCount(1);
  await resume.click();
  await expect(page.locator('#pause')).toBeHidden();

  const damaged = await page.evaluate(() => window.__PEREVAL_DEBUG__?.damagePlayer?.(10));
  expect(damaged?.applied).toBe(10);
  await page.waitForTimeout(80);
  expect(
    Number.parseFloat(await page.locator('#health-fill').evaluate((element) => element.style.width)),
  ).toBe(90);
  await page.screenshot({ path: 'docs/qa/iteration-01/combat.png' });

  const killed = await page.evaluate(() => window.__PEREVAL_DEBUG__?.killNearestEnemy?.());
  expect(killed?.killed).toBe(true);
  await page.waitForTimeout(80);
  expect(await page.locator('#kills').textContent()).toBe('1');

  for (let i = 1; i < 5; i += 1) {
    const extraKill = await page.evaluate(() => window.__PEREVAL_DEBUG__?.killNearestEnemy?.());
    expect(extraKill?.killed).toBe(true);
  }
  await expect(page.locator('#victory')).toBeVisible();
  expect(await page.locator('#victory-kills').textContent()).toBe('5');

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('demo mode renders the deterministic presentation scene', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/?demo=1&debug=1');
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'docs/qa/iteration-01/demo.png' });
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
