const { test, expect } = require('../fixtures');

test.describe('home page', () => {
  test('shows the hero with both action buttons (search bar lives in the top nav, not here)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.home-hero h1')).toContainText('Everything Riftbound');
    await expect(page.locator('.home-hero-ctas [data-nav="cards"]')).toContainText('Trade / Search for Cards');
    await expect(page.locator('.home-hero-ctas [data-nav="collection"]')).toContainText('Add to Collection');
  });

  // This fixture blocks Supabase (see ../fixtures), so no price data ever
  // loads -- exactly what a self-hosted deployment without card_prices
  // configured sees. The rail should degrade to a plain message, not an
  // empty/broken-looking section. The populated, sorted-by-price case is
  // covered separately in home-valuable-cards.spec.js with mocked prices.
  test('"Most valuable cards" degrades gracefully with no price data', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.home-trending')).toContainText('Most valuable cards');
    await expect(page.locator('.home-trending-rail .card-tile')).toHaveCount(0);
    await expect(page.locator('.home-trending')).toContainText('Price data is still loading');
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
