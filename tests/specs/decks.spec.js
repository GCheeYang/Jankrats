const { test, expect } = require('../fixtures');

test.describe('decks', () => {
  test('starts with an empty state and no decks', async ({ page }) => {
    await page.goto('/decks');
    await expect(page.locator('#view-decks')).toContainText('No decks yet');
  });

  test('"+ New deck" creates a deck and opens the builder', async ({ page }) => {
    await page.goto('/decks');
    await page.click('[data-action="new-deck"]');
    await expect(page.locator('.deck-row')).toHaveCount(1);
    await expect(page.locator('#builder-host')).not.toBeEmpty();
  });

  test('deleting a deck removes it after confirmation', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await page.goto('/decks');
    await page.click('[data-action="new-deck"]');
    await expect(page.locator('.deck-row')).toHaveCount(1);
    await page.click('[data-del]');
    await expect(page.locator('.deck-row')).toHaveCount(0);
    await expect(page.locator('#view-decks')).toContainText('No decks yet');
  });

  test('a new deck also shows up on the dashboard\'s recent decks and stat tile', async ({ page }) => {
    await page.goto('/decks');
    await page.click('[data-action="new-deck"]');
    await page.locator('.nav button[data-view="dashboard"]').click();
    await expect(page.locator('#view-dashboard .stat-card .num').nth(2)).toHaveText('1');
    await expect(page.locator('#view-dashboard .deck-row')).toHaveCount(1);
  });
});
