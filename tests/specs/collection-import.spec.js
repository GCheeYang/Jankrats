const { test, expect } = require('../fixtures');

// These run with the Supabase bundle blocked (see fixtures.js), so
// JVBackend.isConfigured() is false and Collection renders its real
// (local-only) content instead of a sign-in gate -- there's no way to
// complete real OAuth in a headless test run.

test.describe('collection', () => {
  test('starts empty with a pointer to Explore Cards and Import', async ({ page }) => {
    await page.goto('/collection');
    await expect(page.locator('#view-collection')).toContainText('Nothing owned yet');
    await expect(page.locator('#view-collection')).toContainText('0 / ');
    await expect(page.locator('#open-import-btn')).toBeVisible();
  });

  test('Import cards button opens a modal with JSON selected by default', async ({ page }) => {
    await page.goto('/collection');
    await page.click('#open-import-btn');
    await expect(page.locator('#import-modal')).toBeVisible();
    await expect(page.locator('#import-modal h2')).toHaveText('Import to Collection');
    await expect(page.locator('[data-tab2="json"]')).toHaveClass(/active/);
    await expect(page.locator('#import-schema')).toContainText('qty');
  });

  test('switching to the CSV tab updates the schema hint', async ({ page }) => {
    await page.goto('/collection');
    await page.click('#open-import-btn');
    await page.click('[data-tab2="csv"]');
    await expect(page.locator('[data-tab2="csv"]')).toHaveClass(/active/);
    await expect(page.locator('#import-schema')).toContainText('id,qty,foil');
  });

  test('closing the modal (X, backdrop click, or nothing typed) all work', async ({ page }) => {
    await page.goto('/collection');
    await page.click('#open-import-btn');
    await page.click('#import-modal .modal-close');
    await expect(page.locator('#import-modal')).toHaveCount(0);

    await page.click('#open-import-btn');
    await page.locator('#import-modal').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#import-modal')).toHaveCount(0);
  });

  test('importing JSON updates the collection and Collection refreshes once the modal closes', async ({ page }) => {
    await page.goto('/collection');
    await page.click('#open-import-btn');
    await page.fill('#import-text', JSON.stringify([{ id: 'OGN-179/298', qty: 3 }]));
    await page.click('#import-run');
    await expect(page.locator('#import-result')).toContainText('1 card updated');
    await page.click('#import-modal .modal-close');
    await expect(page.locator('#view-collection')).toContainText('1 / ');
    await expect(page.locator('#view-collection .coll-tile')).toHaveCount(1);
  });

  test('importing CSV works too', async ({ page }) => {
    await page.goto('/collection');
    await page.click('#open-import-btn');
    await page.click('[data-tab2="csv"]');
    await page.fill('#import-text', 'id,qty,foil\nOGN-179/298,2,1');
    await page.click('#import-run');
    await expect(page.locator('#import-result')).toContainText('1 card updated');
  });

  test('invalid JSON shows an error instead of silently doing nothing', async ({ page }) => {
    await page.goto('/collection');
    await page.click('#open-import-btn');
    await page.fill('#import-text', 'not json');
    await page.click('#import-run');
    await expect(page.locator('#import-result')).toContainText("not a valid JSON array");
  });

  test('an unmatched card id is reported instead of failing the whole import', async ({ page }) => {
    await page.goto('/collection');
    await page.click('#open-import-btn');
    await page.fill('#import-text', JSON.stringify([{ id: 'NOT-A-REAL-ID/1', qty: 1 }]));
    await page.click('#import-run');
    await expect(page.locator('#import-result')).toContainText('no card found');
  });

  test('the voice/text import section is present with its own textarea', async ({ page }) => {
    await page.goto('/collection');
    await page.click('#open-import-btn');
    await expect(page.locator('#import-modal')).toContainText('Speak your collection');
    await expect(page.locator('#voice-transcript')).toBeVisible();
  });

  test('collection grid paginates automatically past 100 owned cards', async ({ page }) => {
    await page.goto('/collection');
    const ids = await page.evaluate(() => window.__RIFTBOUND_CARDS__.slice(0, 110).map((c) => c.id));
    await page.click('#open-import-btn');
    await page.fill('#import-text', JSON.stringify(ids.map((id) => ({ id, qty: 1 }))));
    await page.click('#import-run');
    await expect(page.locator('#import-result')).toContainText('110 cards updated');
    await page.click('#import-modal .modal-close');
    await expect(page.locator('#view-collection .coll-tile')).toHaveCount(100);
    await page.locator('#cof-load-sentinel').scrollIntoViewIfNeeded();
    await expect(page.locator('#view-collection .coll-tile')).toHaveCount(110);
  });
});
