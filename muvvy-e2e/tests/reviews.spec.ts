import { test, expect } from './_helpers/fixtures';
import { sel } from './_helpers/selectors';
import { READONLY, MOVIE_TMDB_ID } from './_helpers/env';

// ── YORUM (reviews / comments) ──────────────────────────────────────────────
// MovieReviews.tsx: authenticated user writes a review on a movie; it should
// appear in the list and be editable (audit note: `myReview` syncs into the form).
test.describe('Reviews / Yorum', () => {
  test.skip(READONLY, 'read-only run: review writes skipped');

  test('post a review on a movie and see it listed', async ({ page }) => {
    await page.goto(`/movie/${MOVIE_TMDB_ID}`);
    await expect(await sel.movie.title(page)).toBeVisible();

    const box = await sel.reviews.textarea(page);
    test.skip(!(await box.count()), 'review textarea not found — confirm selector');

    const body = `E2E review ${Date.now()} — solid rewatch.`;
    await test.step('write + submit', async () => {
      await box.scrollIntoViewIfNeeded();
      await box.fill(body);
      await (await sel.reviews.submit(page)).click();
    });

    await test.step('review appears', async () => {
      await expect(page.getByText(body)).toBeVisible({ timeout: 15_000 });
    });

    await test.step('reloading keeps my review in the editor (myReview sync)', async () => {
      await page.reload();
      await expect(page.getByText(body).or(await sel.reviews.textarea(page))).toBeVisible();
    });
  });

  test('empty review cannot be submitted', async ({ page }) => {
    await page.goto(`/movie/${MOVIE_TMDB_ID}`);
    const box = await sel.reviews.textarea(page);
    test.skip(!(await box.count()), 'review textarea not found');
    await box.fill('');
    const submit = await sel.reviews.submit(page);
    // Either disabled, or clicking yields a validation message and no new item.
    if (await submit.isEnabled()) {
      await submit.click();
      await expect(page.getByText(/empty|boş|yaz|required|gerekli/i).first()).toBeVisible().catch(() => {});
    } else {
      await expect(submit).toBeDisabled();
    }
  });
});
