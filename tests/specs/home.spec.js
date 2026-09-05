const { test, expect } = require('../fixtures');

test.describe('home page', () => {
  test('shows the two feature tiles', async ({ page }) => {
    await page.goto('/');
    const tiles = page.locator('.feature-tile');
    await expect(tiles).toHaveCount(2);
    await expect(tiles.nth(0)).toContainText('Trade / Search for Cards');
    await expect(tiles.nth(0)).toContainText('Explore Cards');
    await expect(tiles.nth(1)).toContainText('Add to Collection');
    await expect(tiles.nth(1)).toContainText('Go to Collection');
  });

  test('"Trade / Search for Cards" tile navigates to Explore Cards', async ({ page }) => {
    await page.goto('/');
    await page.locator('.feature-tile[data-nav="cards"]').click();
    await expect(page).toHaveURL(/\/cards$/);
    await expect(page.locator('#view-cards h1')).toHaveText('Explore Cards');
  });

  test('"Add to Collection" tile navigates to Collection', async ({ page }) => {
    await page.goto('/');
    await page.locator('.feature-tile[data-nav="collection"]').click();
    await expect(page).toHaveURL(/\/collection$/);
    await expect(page.locator('#view-collection h1')).toHaveText('Collection');
  });
});
