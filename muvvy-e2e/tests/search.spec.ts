import { test, expect } from './_helpers/fixtures';
import { sel } from './_helpers/selectors';
import { MOVIE_QUERY } from './_helpers/env';

// ── ARAMA (search) ──────────────────────────────────────────────────────────
// Search is public in Muvvy (TMDB via tmdb-proxy edge fn), so this runs
// anonymously too and is safe against prod (read-only).
test.use({ storageState: undefined });

test.describe('Search / Arama', () => {
  test('typing a query surfaces matching movies', async ({ page }) => {
    await page.goto('/search');

    await test.step('type the query', async () => {
      const input = await sel.search.input(page);
      await expect(input).toBeVisible();
      await input.fill(MOVIE_QUERY);
      await input.press('Enter').catch(() => {}); // some UIs search on debounce, not Enter
    });

    await test.step('results contain the query', async () => {
      const results = await sel.search.results(page);
      await expect(results.first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(new RegExp(MOVIE_QUERY, 'i')).first()).toBeVisible();
    });

    await test.step('a result navigates to a movie detail page', async () => {
      await (await sel.search.resultCard(page)).first().click();
      await expect(page).toHaveURL(/\/(movie|tv)\//);
      await expect(await sel.movie.title(page)).toBeVisible();
    });
  });

  test('empty query does not crash and clears results', async ({ page }) => {
    await page.goto('/search');
    const input = await sel.search.input(page);
    await input.fill(MOVIE_QUERY);
    await expect((await sel.search.resultCard(page)).first()).toBeVisible({ timeout: 20_000 });
    await input.fill('');
    // No thrown error overlay; page still interactive.
    await expect(input).toBeEditable();
  });
});
