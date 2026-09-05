const { test, expect } = require('../fixtures');

test.describe('dashboard', () => {
  test('defaults to the classic Ahri banner and "Choose a banner" (not "Change")', async ({ page }) => {
    await page.goto('/dashboard');
    const img = page.locator('#view-dashboard .profile-banner-img');
    await expect(img).toHaveAttribute('src', /Ahri\/splash-art\/centered\/skin\/0/);
    await expect(page.locator('#change-banner-btn')).toHaveText('Choose a banner');
  });

  test('shows zeroed stats and a "Start exploring" sample row for a brand-new visitor', async ({ page }) => {
    await page.goto('/dashboard');
    const stats = await page.locator('#view-dashboard .stat-card .num').allTextContents();
    expect(stats).toEqual(['0', '0', '0']);
    await expect(page.locator('#view-dashboard')).toContainText('Start exploring');
    await expect(page.locator('#view-dashboard .card-tile')).toHaveCount(6);
  });

  test('stat tiles and "Start exploring" reflect a non-empty collection', async ({ page }) => {
    await page.goto('/collection');
    await page.click('#open-import-btn');
    await page.fill('#import-text', JSON.stringify([{ id: 'OGN-179/298', qty: 2, foil: 1 }]));
    await page.click('#import-run');
    await page.click('#import-modal .modal-close');

    await page.locator('.nav button[data-view="dashboard"]').click();
    const stats = await page.locator('#view-dashboard .stat-card .num').allTextContents();
    expect(stats).toEqual(['3', '1', '0']); // total owned, unique owned, decks brewed
    await expect(page.locator('#view-dashboard')).not.toContainText('Start exploring');
  });

  test('the old sidebar rail is gone -- top bar only', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('.rail')).toHaveCount(0);
    await expect(page.locator('.topbar')).toBeVisible();
    const height = await page.locator('.topbar').evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeLessThan(120);
  });
});
