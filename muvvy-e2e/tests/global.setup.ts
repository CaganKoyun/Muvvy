import { test as setup } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { MODE, ACCOUNT_1, ACCOUNT_2, requireAccount } from './_helpers/env';
import { loginViaUI } from './_helpers/auth';

setup.describe.configure({ mode: 'serial' });

setup('authenticate account 1', async ({ page }) => {
  if (MODE !== 'live') return; // mock mode fakes its own session
  requireAccount(ACCOUNT_1, 'account 1');
  mkdirSync('tests/.auth', { recursive: true });
  await loginViaUI(page, ACCOUNT_1);
  await page.context().storageState({ path: ACCOUNT_1.storageState });
});

setup('authenticate account 2 (optional)', async ({ page }) => {
  if (MODE !== 'live') return;
  if (!ACCOUNT_2.email) {
    setup.skip(true, 'No E2E_EMAIL_2 set — messages/co-watch two-user specs will skip.');
    return;
  }
  mkdirSync('tests/.auth', { recursive: true });
  await loginViaUI(page, ACCOUNT_2);
  await page.context().storageState({ path: ACCOUNT_2.storageState });
});
