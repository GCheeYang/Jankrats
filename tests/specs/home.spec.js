const { test, expect } = require('../fixtures');

test.describe('home page', () => {
  test('shows the hero with a search bar and both action buttons', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.home-hero h1')).toContainText('Everything Riftbound');
    await expect(page.locator('#home-search')).toBeVisible();
    await expect(page.locator('.home-hero-ctas [data-nav="cards"]')).toContainText('Trade / Search for Cards');
    await expect(page.locator('.home-hero-ctas [data-nav="collection"]')).toContainText('Add to Collection');
  });

  test('shows a trending-cards rail with real, clickable cards', async ({ page }) => {
    await page.goto('/');
    const tiles = page.locator('.home-trending-rail .card-tile');
    await expect(tiles.first()).toBeVisible();
    await tiles.first().click();
    await expect(page.locator('#card-modal')).toBeVisible();
  });

  test('the hero search bar searches cards on Enter', async ({ page }) => {
    await page.goto('/');
    await page.fill('#home-search', 'Abandoned Hall');
    await page.press('#home-search', 'Enter');
    await expect(page).toHaveURL(/\/cards$/);
    await expect(page.locator('#cf-q')).toHaveValue('Abandoned Hall');
    await expect(page.locator('#view-cards .card-tile')).toHaveCount(1);
  });

  test('"Trade / Search for Cards" button navigates to Explore Cards', async ({ page }) => {
    await page.goto('/');
    await page.click('.home-hero-ctas [data-nav="cards"]');
    await expect(page).toHaveURL(/\/cards$/);
    await expect(page.locator('#view-cards h1')).toHaveText('Explore Cards');
  });

  test('"Add to Collection" button navigates to Collection', async ({ page }) => {
    await page.goto('/');
    await page.click('.home-hero-ctas [data-nav="collection"]');
    await expect(page).toHaveURL(/\/collection$/);
    await expect(page.locator('#view-collection h1')).toHaveText('Collection');
  });
});
