import { defineConfig, devices } from '@playwright/test';

// Minimal .env loader (no dependency): reads ./.env into process.env if present.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const BASE_URL = process.env.BASE_URL || 'https://muvvy.now';
const MODE = (process.env.E2E_MODE || 'live') as 'live' | 'mock';

export default defineConfig({
  testDir: './tests',
  // Writes to a live/shared backend → keep it serial-ish and low-parallel by default so
  // two accounts don't race on friendship/conversation state.
  fullyParallel: MODE === 'mock',
  workers: MODE === 'mock' ? undefined : 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 12_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // muvvy.now serves over a stack that may present the agent-proxy MITM cert in
    // sandboxed CI; harmless for functional testing. Real prod is unaffected.
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    // Auth bootstrap: logs the two accounts in once and stores their sessions.
    { name: 'setup', testMatch: /global\.setup\.ts/ },

    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: MODE === 'live' ? ['setup'] : [],
    },
    {
      name: 'mobile',
      testIgnore: /messages|cowatch/, // two-account flows: desktop project only
      use: { ...devices['Pixel 7'] },
      dependencies: MODE === 'live' ? ['setup'] : [],
    },
  ],

  // Uncomment to auto-start a local Muvvy dev server for mock/local runs:
  // webServer: MODE === 'mock' ? {
  //   command: 'npm run dev',
  //   cwd: '..',                 // the Muvvy app root
  //   url: BASE_URL,
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 120_000,
  // } : undefined,
});
