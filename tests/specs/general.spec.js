const { test, expect } = require('../fixtures');

test.describe('dark-only theme', () => {
  test('there is no theme toggle button anywhere in the shell', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#theme-toggle')).toHaveCount(0);
    await expect(page.locator('.theme-toggle')).toHaveCount(0);
  });

  test('forcing data-theme="light" has no effect -- the light palette is gone', async ({ page }) => {
    await page.goto('/');
    const darkGround = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ground').trim());
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    const afterGround = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ground').trim());
    expect(afterGround).toBe(darkGround);
  });
});

test.describe('responsive top bar', () => {
  test('no horizontal overflow at a typical laptop width (1280px)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    const overflowing = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflowing).toBe(false);
    const topbarHeight = await page.locator('.topbar').evaluate((el) => el.getBoundingClientRect().height);
    expect(topbarHeight).toBeLessThan(120);
  });

  test('nav wraps cleanly on mobile without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    const overflowing = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflowing).toBe(false);
    await expect(page.locator('.nav button[data-view="home"]')).toBeVisible();
  });
});
