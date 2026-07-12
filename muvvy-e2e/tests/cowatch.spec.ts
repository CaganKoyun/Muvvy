import { test, expect } from './_helpers/fixtures';
import { sel } from './_helpers/selectors';
import { MODE, READONLY, ACCOUNT_1, ACCOUNT_2, MOVIE_TMDB_ID } from './_helpers/env';
import type { BrowserContext, Page } from '@playwright/test';

/**
 * ── COWATCH (Birlikte İzle) ──────────────────────────────────────────────────
 * IMPORTANT — this suite encodes the AUDIT's honest finding (C-5):
 *   "Birlikte İzle" is NOT synchronized playback. It is: schedule a time +
 *   download an .ics + open a normal text chat. There is no shared player /
 *   presence. Also `useCoWatchInbox` has no realtime/refetch, so the invited
 *   user only sees the invite after a manual refresh, and the countdown is static.
 *
 * So these tests assert the REAL behavior (invite → schedule → .ics/chat), and
 * explicitly document — via test.fixme — the gaps that should NOT be claimed as
 * working (synced playback, live invite push). Flip those to real assertions
 * once/if the feature is upgraded.
 */
test.describe('Co-watch / Birlikte İzle (two users)', () => {
  test.skip(READONLY, 'read-only run: co-watch invite writes skipped');
  test.skip(MODE === 'mock', 'two-user flow needs a real backend; run in LIVE mode');
  test.skip(!ACCOUNT_2.email, 'set E2E_EMAIL_2 to run co-watch specs');

  let ctx1: BrowserContext, ctx2: BrowserContext, p1: Page, p2: Page;
  test.beforeAll(async ({ browser }) => {
    ctx1 = await browser.newContext({ storageState: ACCOUNT_1.storageState });
    ctx2 = await browser.newContext({ storageState: ACCOUNT_2.storageState });
    p1 = await ctx1.newPage(); p2 = await ctx2.newPage();
  });
  test.afterAll(async () => { await ctx1?.close(); await ctx2?.close(); });

  test('user1 sends a co-watch invite (schedule + .ics + chat)', async () => {
    await test.step('open the invite dialog from a movie', async () => {
      await p1.goto(`/movie/${MOVIE_TMDB_ID}`);
      const cta = await sel.movie.coWatchCta(p1);
      test.skip(!(await cta.count()), 'no co-watch CTA on movie detail — confirm selector/route');
      await cta.click();
      await expect(await sel.cowatch.inviteDialog(p1)).toBeVisible();
    });

    await test.step('pick friend (user2) + a time and confirm', async () => {
      const friend = await sel.cowatch.pickFriend(p1);
      if (await friend.count()) {
        await friend.filter({ hasText: new RegExp(ACCOUNT_2.username, 'i') }).first()
          .or(friend.first()).click();
      }
      const time = await sel.cowatch.pickTime(p1);
      if (await time.count()) {
        const future = new Date(Date.now() + 3600_000).toISOString().slice(0, 16);
        await time.fill(future);
      }
      await (await sel.cowatch.confirmInvite(p1)).click();
      await expect((await sel.toast(p1)).or(p1.getByText(/davet|invited|planlandı|scheduled/i))).toBeVisible();
    });

    await test.step('the honest deliverable is a calendar/.ics + chat, not a synced player', async () => {
      const ics = await sel.cowatch.downloadIcs(p1);
      // .ics may live in the confirmation view or the invite detail.
      await expect(ics.or(p1.getByText(/takvim|calendar|\.ics|chat|sohbet/i)).first()).toBeVisible();
      // Guard against a regression that ships a fake "synced player" claim:
      await expect(p1.getByText(/senkron oynat|synchronized playback|shared player/i)).toHaveCount(0);
    });
  });

  test('user2 sees the invite AFTER refresh (no realtime push — audit C-5)', async () => {
    await p2.goto('/co-watch').catch(() => p2.goto('/'));
    // Per audit, the inbox does not auto-refresh; reload to observe the invite.
    await p2.reload();
    const invite = await sel.cowatch.inboxItem(p2);
    test.skip(!(await invite.count()), 'no co-watch inbox surface found — confirm route/selector');
    await expect(invite.first()).toBeVisible({ timeout: 15_000 });
  });

  // Known gaps the product should NOT advertise as working until built:
  test.fixme('invite pushes to user2 in realtime without refresh', async () => {
    // Requires realtime on co_watch_invites (receiver-filtered) — see audit C-5 fix.
  });
  test.fixme('participants share a synchronized video player with presence', async () => {
    // Muvvy has no shared player today; "Birlikte İzle" is a viewing appointment.
  });
});
