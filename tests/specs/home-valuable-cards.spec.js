// Uses the plain Playwright `test` (not ../fixtures) so the real Supabase
// bundle loads and app.js's loadCardPrices() actually attempts a fetch --
// then we intercept that one REST call with fixed, known prices instead of
// hitting the live database, so the "Most valuable cards" rail's sort
// order is deterministic and doesn't depend on real (changing) price data.
const { test, expect } = require('@playwright/test');

test.describe('home page: most valuable cards', () => {
  test('shows the top-priced cards, sorted highest first, and they are clickable', async ({ page }) => {
    await page.goto('/');
    const ids = await page.evaluate(() =>
      window.__RIFTBOUND_CARDS__.filter((c) => c.imageUrl).slice(0, 3).map((c) => c.id)
    );
    expect(ids.length).toBe(3);

    await page.route('**/rest/v1/card_prices**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { card_id: ids[0], en_price_usd: 500, en_foil_price_usd: null, updated_at: new Date().toISOString() },
          { card_id: ids[1], en_price_usd: 50, en_foil_price_usd: null, updated_at: new Date().toISOString() },
          { card_id: ids[2], en_price_usd: 5, en_foil_price_usd: null, updated_at: new Date().toISOString() },
        ]),
      })
    );
    await page.reload();

    const rail = page.locator('.home-trending-rail .card-tile-wrap');
    await expect(rail.first()).toBeVisible();
    const prices = await page.locator('.home-trending-rail .ct-price-link').allTextContents();
    expect(prices.slice(0, 3)).toEqual(['$500.00 ↗', '$50.00 ↗', '$5.00 ↗']);

    await page.locator('.home-trending-rail .card-tile').first().click();
    await expect(page.locator('#card-modal')).toBeVisible();
  });
});
