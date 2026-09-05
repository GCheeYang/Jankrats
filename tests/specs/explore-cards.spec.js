const { test, expect } = require('../fixtures');

test.describe('explore cards', () => {
  test('loads with the full card count and a default page of tiles', async ({ page }) => {
    await page.goto('/cards');
    await expect(page.locator('#view-cards .card-tile')).toHaveCount(60);
    await expect(page.locator('#view-cards')).toContainText(/Showing 60 of \d+/);
  });

  test('search narrows the grid to matching cards', async ({ page }) => {
    await page.goto('/cards');
    await page.fill('#cf-q', 'Abandoned Hall');
    await page.waitForTimeout(200); // debounced re-render (rerenderSoft)
    const tiles = page.locator('#view-cards .card-tile');
    await expect(tiles).toHaveCount(1);
    await expect(tiles.first()).toContainText('Abandoned Hall');
  });

  test('domain filter only shows cards that include that domain', async ({ page }) => {
    await page.goto('/cards');
    await page.selectOption('#cf-domain', 'Fury');
    const tiles = page.locator('#view-cards .card-tile-wrap');
    await expect(tiles.first()).toBeVisible();
    const count = await tiles.count();
    // cards can be dual-domain, so assert each tile has a Fury chip
    // among its domain chips rather than only a Fury chip.
    for (let i = 0; i < count; i++) {
      const chips = await tiles.nth(i).locator('.domain-chip').allTextContents();
      expect(chips.map((c) => c.trim())).toContain('Fury');
    }
  });

  test('type filter only shows that card type', async ({ page }) => {
    await page.goto('/cards');
    await page.selectOption('#cf-type', 'Battlefield');
    const grid = await page.locator('#view-cards .card-grid').innerText();
    expect(grid).toContain('Battlefield');
    const tileCount = await page.locator('#view-cards .card-tile').count();
    expect(tileCount).toBeGreaterThan(0);
  });

  test('sort by cost orders the visible tiles ascending', async ({ page }) => {
    await page.goto('/cards');
    await page.selectOption('#cf-sort', 'cost');
    const costs = await page.locator('#view-cards .ct-cost').allTextContents();
    const nums = costs.map((c) => parseInt(c, 10)).filter((n) => !Number.isNaN(n));
    const sorted = [...nums].sort((a, b) => a - b);
    expect(nums).toEqual(sorted);
  });

  test('clicking a card opens its detail modal', async ({ page }) => {
    await page.goto('/cards');
    await page.locator('#view-cards .card-tile').first().click();
    await expect(page.locator('#card-modal')).toBeVisible();
    await expect(page.locator('#card-modal .modal-head h2')).not.toBeEmpty();
    await page.locator('#card-modal .modal-close').click();
    await expect(page.locator('#card-modal')).toHaveCount(0);
  });

  test('scrolling near the bottom loads the next page automatically, no button', async ({ page }) => {
    await page.goto('/cards');
    await expect(page.locator('#view-cards .card-tile')).toHaveCount(60);
    await expect(page.locator('#cf-load-more')).toHaveCount(0); // old button is gone
    await page.locator('#cf-load-sentinel').scrollIntoViewIfNeeded();
    await expect(page.locator('#view-cards .card-tile')).toHaveCount(120);
  });

  test('regression: rotated Battlefield card art stays inside its tile (no overflow)', async ({ page }) => {
    await page.goto('/cards');
    await page.fill('#cf-q', 'Abandoned Hall');
    await page.waitForTimeout(200);
    const img = page.locator('#view-cards .card-tile .ct-img img.rot90').first();
    await expect(img).toHaveCount(1);
    const overflow = await img.evaluate((el) => {
      const imgRect = el.getBoundingClientRect();
      const boxRect = el.parentElement.getBoundingClientRect();
      return {
        left: imgRect.left < boxRect.left - 0.5,
        right: imgRect.right > boxRect.right + 0.5,
        top: imgRect.top < boxRect.top - 0.5,
        bottom: imgRect.bottom > boxRect.bottom + 0.5,
      };
    });
    expect(overflow).toEqual({ left: false, right: false, top: false, bottom: false });
  });
});
