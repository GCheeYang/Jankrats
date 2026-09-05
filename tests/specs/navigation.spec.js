const { test, expect } = require('../fixtures');

test.describe('top nav', () => {
  test('lands on Home at the bare root, with Home highlighted', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('.nav button[data-view="home"]')).toHaveClass(/active/);
    await expect(page.locator('#view-home')).toBeVisible();
  });

  test('nav order has Home first and Dashboard last', async ({ page }) => {
    await page.goto('/');
    const labels = await page.locator('.nav button').allTextContents();
    expect(labels[0]).toContain('Home');
    expect(labels[labels.length - 1]).toContain('Dashboard');
    expect(labels.some((l) => l.includes('Import'))).toBe(false);
  });

  test('every nav tab routes to its own view and updates the URL', async ({ page }) => {
    await page.goto('/');
    const cases = [
      ['cards', 'Explore Cards', '/cards'],
      ['collection', 'Collection', '/collection'],
      ['friends', 'Friends', '/friends'],
      ['decks', 'Decks', '/decks'],
      ['dashboard', 'Dashboard', '/dashboard'],
      ['home', 'Home', '/'],
    ];
    for (const [view, label, path] of cases) {
      await page.locator(`.nav button[data-view="${view}"]`).click();
      await expect(page.locator(`#view-${view}`)).toBeVisible();
      await expect(page.locator(`.nav button[data-view="${view}"]`)).toHaveClass(/active/);
      await expect(page).toHaveURL(new RegExp(path.replace('/', '\\/') + '$'));
    }
  });

  test('direct navigation to a clean URL path loads the right view (deep link)', async ({ page }) => {
    await page.goto('/collection');
    await expect(page.locator('.nav button[data-view="collection"]')).toHaveClass(/active/);
    await expect(page.locator('#view-collection')).toBeVisible();
  });

  test('browser back button restores the previous view', async ({ page }) => {
    await page.goto('/');
    await page.locator('.nav button[data-view="cards"]').click();
    await expect(page).toHaveURL(/\/cards$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('.nav button[data-view="home"]')).toHaveClass(/active/);
  });

  test('no JS errors while clicking through every tab', async ({ page }) => {
    // Only real script errors -- not "Failed to load resource" console
    // noise from third-party card-art images, which is a network/CDN
    // concern unrelated to app logic.
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) errors.push(msg.text());
    });
    await page.goto('/');
    for (const view of ['cards', 'collection', 'friends', 'decks', 'dashboard', 'home']) {
      await page.locator(`.nav button[data-view="${view}"]`).click();
    }
    expect(errors).toEqual([]);
  });
});
