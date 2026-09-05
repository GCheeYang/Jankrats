// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const PORT = process.env.JANKRATS_TEST_PORT || 8199;
const BASE_URL = `http://localhost:${PORT}`;

module.exports = defineConfig({
  testDir: './specs',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `node ../.claude/static-server.js`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
  },
});
