# Jankrats e2e tests

Playwright tests that drive the real site in a browser. Lives in its own
folder with its own `package.json`, same pattern as `scripts/price-scraper` —
the site itself stays no-build/no-dependencies; only this test tooling needs
`npm install`.

## Setup

```bash
cd tests
npm install
npx playwright install chromium
```

## Run

```bash
npm test              # headless, all specs
npm run test:headed   # watch it click through the site
npm run test:ui       # Playwright's interactive UI mode
npm run report        # open the HTML report from the last run
```

The config starts `.claude/static-server.js` on port 8199 automatically (set
`JANKRATS_TEST_PORT` to change it) and tears it down after the run.

## How the auth split works

`config.js` ships this repo's real (public, client-safe) Supabase
credentials, so a normal page load has `JVBackend.isConfigured()` return
true — meaning Collection, Import, and the dashboard's personal stats all sit
behind a real sign-in gate that a headless run can't complete.

Most specs import from `./fixtures` instead of `@playwright/test` directly.
That fixture blocks the Supabase JS bundle so `window.supabase` never gets
defined, which makes `isConfigured()` reliably false — the same fallback
path a self-hosted deployment without Supabase configured would take. That
unlocks testing Collection/Import/Dashboard without real credentials.

`specs/auth-gates.spec.js` deliberately uses the plain Playwright `test`
instead, so the real backend config loads and it can assert the actual
sign-in gates render correctly for a signed-out visitor. It never clicks a
real "Continue with Google/Discord" button — that would navigate to the
actual OAuth provider.
