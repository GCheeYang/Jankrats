// Unlike the rest of the suite, these use the plain Playwright `test` (not
// ../fixtures) so the real Supabase bundle loads and JVBackend.isConfigured()
// is true against this repo's real project -- exactly what a signed-out
// visitor to the live site sees. We only assert on what renders; we never
// click a real "Continue with Google/Discord" button, since that would
// navigate the browser to the actual OAuth provider.
const { test, expect } = require('@playwright/test');

test.describe('signed-out gates (real backend config)', () => {
  test('top bar shows both provider buttons directly, not a single "Sign in" button', async ({ page }) => {
    await page.goto('/');
    const authHost = page.locator('#social-auth-host');
    // visible without any prior click -- there is no toggle button to open a menu
    await expect(authHost.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(authHost.getByRole('button', { name: 'Continue with Discord' })).toBeVisible();
    await expect(page.locator('.signin-menu, #auth-signin-toggle')).toHaveCount(0);
  });

  test('Collection shows a sign-in gate with a blurred card backdrop', async ({ page }) => {
    await page.goto('/collection');
    await expect(page.locator('.gate-overlay')).toContainText('Sign in to continue');
    await expect(page.locator('.gate-overlay').getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.locator('.gate-overlay').getByRole('button', { name: 'Continue with Discord' })).toBeVisible();
    await expect(page.locator('.gate-preview .card-tile').first()).toBeVisible();
  });

  test('card detail modal offers sign-in instead of owned/foil steppers', async ({ page }) => {
    await page.goto('/cards');
    await page.locator('#view-cards .card-tile').first().click();
    await expect(page.locator('#card-modal')).toContainText('Sign in to track how many you own.');
    await expect(page.locator('#card-modal').getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  });
});
