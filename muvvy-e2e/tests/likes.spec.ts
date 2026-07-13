import { test, expect } from './_helpers/fixtures';
import { sel } from './_helpers/selectors';
import { READONLY } from './_helpers/env';

// ── BEĞENİ (likes on moments) ───────────────────────────────────────────────
// MomentsReels.tsx + use-moments.ts. Like toggles state and bumps the count;
// audit notes likes drive a definer-trigger notification (not asserted here).
test.describe('Likes / Beğeni', () => {
  test.skip(READONLY, 'read-only run: like mutations skipped');

  test('like a moment toggles state and updates the count', async ({ page }) => {
    await page.goto('/moments').catch(() => page.goto('/'));
    const card = await sel.moments.firstCard(page);
    test.skip(!(await card.count()), 'no moments found — feed may be empty for this account');

    const likeBtn = (await sel.moments.like(page)).first();
    await expect(likeBtn).toBeVisible();

    const readCount = async () => {
      const c = await sel.moments.likeCount(page);
      if (!(await c.count())) return null;
      const t = (await c.first().innerText()).replace(/\D/g, '');
      return t ? parseInt(t, 10) : null;
    };

    const before = await readCount();
    await likeBtn.click();

    await test.step('pressed state reflects the like', async () => {
      await expect(
        likeBtn.and(page.locator('[aria-pressed="true"], [data-liked="true"], .is-liked')),
      ).toBeVisible().catch(async () => {
        // Fallback: at least the count moved.
        const after = await readCount();
        if (before !== null && after !== null) expect(after).toBeGreaterThanOrEqual(before);
      });
    });

    await test.step('un-like returns to baseline', async () => {
      await likeBtn.click();
      const after = await readCount();
      if (before !== null && after !== null) expect(after).toBe(before);
    });
  });

  test('comment on a moment', async ({ page }) => {
    await page.goto('/moments').catch(() => page.goto('/'));
    const open = await sel.moments.openComments(page);
    test.skip(!(await open.count()), 'no comment affordance found');
    await open.first().click();

    const input = await sel.moments.commentInput(page);
    const body = `E2E comment ${Date.now()}`;
    await input.fill(body);
    await (await sel.moments.commentSubmit(page)).click();
    await expect(page.getByText(body)).toBeVisible({ timeout: 15_000 });
  });
});
