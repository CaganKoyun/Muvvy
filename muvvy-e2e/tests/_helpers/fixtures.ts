import { test as base, expect } from '@playwright/test';
import { MODE, ACCOUNT_1 } from './env';
import { installSupabaseMock } from './supabaseMock';

/**
 * Mode-aware test:
 *  - LIVE: the default context is authenticated as ACCOUNT_1 (via storageState
 *    minted in global.setup.ts). Specs that need anonymity call
 *    `test.use({ storageState: undefined })`.
 *  - MOCK: no real session; installSupabaseMock() fakes auth + backend on every page.
 */
export const test = base.extend<{ _mock: void }>({
  storageState: async ({}, use) => {
    await use(MODE === 'live' ? ACCOUNT_1.storageState : undefined);
  },
  _mock: [
    async ({ page }, use) => {
      if (MODE === 'mock') await installSupabaseMock(page);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
