/**
 * The end-to-end suite: Ridgeline (examples/playground) driven in a real
 * browser, on desktop Chromium and on a phone-sized one.
 *
 * One server and one database for the whole run, which is what makes the
 * journeys real (a message sent in the widget shows up in the dashboard) and
 * also why the run is serial: a test that turns the bot check on in Settings
 * would change the widget under any test running beside it. Each test puts
 * back the Settings it changed (fixtures.ts).
 *
 *   pnpm e2e                      build what is stale, boot, run everything
 *   pnpm e2e --project=desktop    one viewport
 *   pnpm e2e widget               only files whose name matches
 */

import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { stripSecrets } from './support/env.mjs';
import { HOST_ORIGIN, PLAYGROUND } from './support/ports.mjs';

// Before anything is started, so neither the servers nor the test workers
// ever see a real key.
stripSecrets();

const ci = Boolean(process.env.CI);
const root = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: ci
    ? [['list'], ['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  globalSetup: './global-setup.ts',
  use: {
    baseURL: PLAYGROUND,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'node e2e/support/serve-playground.mjs',
      cwd: root,
      url: `${PLAYGROUND}/api/helpwell/health`,
      // A cold build on a slow machine, then the first boot.
      timeout: 300_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'node e2e/support/host-site.mjs',
      cwd: root,
      url: `${HOST_ORIGIN}/health`,
      timeout: 30_000,
      reuseExistingServer: false,
    },
  ],
});
