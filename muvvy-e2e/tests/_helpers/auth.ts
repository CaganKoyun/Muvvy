import { expect, type Page } from '@playwright/test';
import { sel } from './selectors';
import type { Account } from './env';

/**
 * Log a Muvvy account in through the real /auth screen (Supabase email+password).
 * Used by global.setup.ts to mint a storageState per account for LIVE mode.
 */
export async function loginViaUI(page: Page, account: Account) {
  await page.goto('/auth');

  // The screen may default to sign-up; make sure we're on the sign-in tab.
  const toSignIn = page.getByRole('tab', { name: /sign ?in|giriş/i })
    .or(page.getByRole('button', { name: /already.*account|zaten.*hesab|giriş yap/i }));
  if (await toSignIn.count().catch(() => 0)) {
    await toSignIn.first().click({ trial: false }).catch(() => {});
  }

  await (await sel.auth.email(page)).fill(account.email);
  await (await sel.auth.password(page)).fill(account.password);
  await (await sel.auth.submit(page)).click();

  // Success = we leave /auth. Muvvy may route to /onboarding, /setup-username or /.
  await expect(page).not.toHaveURL(/\/auth(\?|$)/, { timeout: 20_000 });

  // If a brand-new account is bounced to username setup, that's a signal the
  // account isn't fully provisioned — fail loudly so the operator fixes the seed.
  if (/\/setup-username/.test(page.url())) {
    throw new Error(
      `[auth] ${account.email} landed on /setup-username — finish onboarding for this ` +
      `test account once, manually, then re-run.`,
    );
  }
}

/** Assert the page is in a logged-in state (avatar/user menu present). */
export async function expectLoggedIn(page: Page) {
  await expect(await sel.nav.avatar(page)).toBeVisible({ timeout: 15_000 });
}
