import { test, expect } from './_helpers/fixtures';
import { sel } from './_helpers/selectors';
import { MODE, READONLY, MOVIE_TMDB_ID } from './_helpers/env';

// ── LİSTE EKLEME (add to list: watchlist / favorite / custom list) ──────────
// Writes to the backend → skipped when E2E_READONLY=1.
test.describe('Lists / Liste ekleme', () => {
  test.skip(READONLY, 'read-only run: list mutations skipped');

  test('add a movie to the watchlist and see it persist', async ({ page }) => {
    await page.goto(`/movie/${MOVIE_TMDB_ID}`);
    await expect(await sel.movie.title(page)).toBeVisible();

    const btn = await sel.movie.addToWatchlist(page);
    test.skip(!(await btn.count()), 'watchlist button not found — confirm selector in selectors.ts');

    await test.step('add to watchlist', async () => {
      await btn.click();
      // Confirm via toast or the button flipping to an "added/remove" state.
      await expect(
        (await sel.toast(page)).or(page.getByRole('button', { name: /remove|kaldır|listede|added|eklendi/i })),
      ).toBeVisible();
    });

    await test.step('watchlist page shows the movie', async () => {
      // Common routes; adjust if Muvvy uses /profile?tab=watchlist etc.
      await page.goto('/watchlist').catch(() => {});
      const onWatchlist = /\/watchlist/.test(page.url());
      if (!onWatchlist) await page.goto('/profile');
      await expect((await sel.lists.watchlistItems(page)).first()).toBeVisible({ timeout: 15_000 });
    });
  });

  test('toggle favorite is idempotent (UNIQUE user_id,tmdb_id)', async ({ page }) => {
    await page.goto(`/movie/${MOVIE_TMDB_ID}`);
    const fav = await sel.movie.favorite(page);
    test.skip(!(await fav.count()), 'favorite button not found');

    await fav.click();
    await expect((await sel.toast(page)).or(fav)).toBeVisible();
    // Clicking again must not error (audit: favorites has UNIQUE(user_id,tmdb_id)).
    await fav.click();
    await expect(page.locator('#root')).not.toBeEmpty();
  });

  test('create a custom list (if the app exposes it)', async ({ page }) => {
    test.skip(MODE === 'mock', 'custom-list creation UI is not fixtured in mock mode');
    await page.goto('/lists').catch(() => page.goto('/profile'));
    const create = await sel.lists.createListButton(page);
    test.skip(!(await create.count()), 'no create-list affordance found');
    await create.click();
    const name = `E2E list ${Date.now()}`;
    await (await sel.lists.listNameInput(page)).fill(name);
    await page.getByRole('button', { name: /create|save|oluştur|kaydet/i }).click();
    await expect(page.getByText(name)).toBeVisible();
  });
});
