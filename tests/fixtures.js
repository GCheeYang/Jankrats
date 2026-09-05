// Shared Playwright fixtures for the Jankrats e2e suite.
const base = require('@playwright/test');

// config.js ships this repo's real Supabase project credentials (the anon
// key is meant to be public -- see config.js's own comment), so
// JVBackend.isConfigured() is true against a normal page load. That's
// correct for production, but it means every collection/import/dashboard
// feature sits behind a real sign-in gate that these tests can't complete
// (no OAuth credentials in CI). Blocking the Supabase JS bundle keeps
// `window.supabase` undefined, which makes isConfigured() reliably false,
// so app.js falls back to its local-only behavior -- the same code path a
// self-hosted deployment without Supabase configured would take. That's
// what most of this suite exercises. Tests that specifically need to see
// the real sign-in gate (auth-gates.spec.js) use the plain `test` from
// @playwright/test instead of this one, so the network call goes through.
const test = base.test.extend({
  page: async ({ page }, use) => {
    await page.route('**/@supabase/supabase-js**', (route) => route.abort());
    await use(page);
  },
});

module.exports = { test, expect: base.expect };
