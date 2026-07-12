import { test, expect } from './_helpers/fixtures';
import { sel } from './_helpers/selectors';
import { MODE, READONLY, ACCOUNT_1, ACCOUNT_2 } from './_helpers/env';
import type { BrowserContext, Page } from '@playwright/test';

// ── MESAJ (direct messages / chat) ──────────────────────────────────────────
// ChatThreadView.tsx + use-chat. DMs are participant-only, block-aware, with a
// non-friend spam cap — so the two test accounts should already be FRIENDS.
// Realtime delivery is a WebSocket; in envs without WS push the receiver refreshes.
test.describe('Messages / Mesaj (two users)', () => {
  test.skip(READONLY, 'read-only run: message sends skipped');
  test.skip(MODE === 'mock', 'two-user round-trip needs a real backend; run in LIVE mode');
  test.skip(!ACCOUNT_2.email, 'set E2E_EMAIL_2 to run two-user message specs');

  let ctx1: BrowserContext, ctx2: BrowserContext, p1: Page, p2: Page;

  test.beforeAll(async ({ browser }) => {
    ctx1 = await browser.newContext({ storageState: ACCOUNT_1.storageState });
    ctx2 = await browser.newContext({ storageState: ACCOUNT_2.storageState });
    p1 = await ctx1.newPage();
    p2 = await ctx2.newPage();
  });
  test.afterAll(async () => { await ctx1?.close(); await ctx2?.close(); });

  test('user1 sends a DM and user2 receives it', async () => {
    const body = `E2E dm ${Date.now()}`;

    await test.step('user1 opens a thread with user2', async () => {
      // Prefer a direct profile → "Message" entry; fall back to the inbox.
      await openUserProfile(p1, ACCOUNT_2.username);
      const msgBtn = p1.getByRole('button', { name: /message|mesaj/i })
        .or(p1.getByRole('link', { name: /message|mesaj/i }));
      if (await msgBtn.count()) await msgBtn.first().click();
      else { await (await sel.nav.messages(p1)).click(); await openConversation(p1, ACCOUNT_2.username); }
      await expect(await sel.messages.composer(p1)).toBeVisible();
    });

    await test.step('user1 sends the message (optimistic render)', async () => {
      await (await sel.messages.composer(p1)).fill(body);
      await (await sel.messages.send(p1)).click();
      await expect(p1.getByText(body)).toBeVisible({ timeout: 15_000 });
    });

    await test.step('user2 sees the message (refresh tolerates missing WS push)', async () => {
      await (await sel.nav.messages(p2)).click().catch(() => p2.goto('/messages'));
      await openConversation(p2, ACCOUNT_1.username);
      await expect(async () => {
        await expect(p2.getByText(body)).toBeVisible({ timeout: 3_000 });
      }).toPass({ timeout: 30_000, intervals: [1000, 2000, 5000] }).catch(async () => {
        await p2.reload();
        await openConversation(p2, ACCOUNT_1.username);
        await expect(p2.getByText(body)).toBeVisible({ timeout: 10_000 });
      });
    });
  });
});

async function openUserProfile(page: Page, username: string) {
  for (const path of [`/@${username}`, `/u/${username}`, `/profile/${username}`, `/user/${username}`]) {
    const resp = await page.goto(path).catch(() => null);
    if (resp && resp.ok() && !/\/(404|not-found)/.test(page.url())) return;
  }
  // last resort: search users if the app has people discovery
  await page.goto('/discover');
}

async function openConversation(page: Page, otherUsername: string) {
  const item = page.getByRole('link', { name: new RegExp(otherUsername, 'i') })
    .or(page.getByText(new RegExp(`@?${otherUsername}`, 'i')).first());
  if (await item.count()) await item.first().click().catch(() => {});
}
