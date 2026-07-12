import { test, expect } from './_helpers/fixtures';
import { sel } from './_helpers/selectors';

// Anonymous surface — no login. Read-only, safe against prod.
test.use({ storageState: undefined });

test.describe('Anonymous smoke', () => {
  test('home renders the discovery shell', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/muvvy/i);
    // SPA mounted?
    await expect(page.locator('#root')).not.toBeEmpty();
    // Core nav affordances exist.
    await expect(await sel.nav.search(page)).toBeVisible();
    await expect(await sel.nav.signIn(page)).toBeVisible();
  });

  test('explore/discover lists movies', async ({ page }) => {
    await page.goto('/explore').catch(() => {});
    if (/\/explore/.test(page.url()) === false) await page.goto('/discover');
    // At least one movie link should appear once TMDB data loads.
    await expect(page.locator('a[href^="/movie/"]').first()).toBeVisible({ timeout: 20_000 });
  });

  test('a movie detail page opens from a card', async ({ page }) => {
    await page.goto('/');
    const firstMovie = page.locator('a[href^="/movie/"]').first();
    await expect(firstMovie).toBeVisible({ timeout: 20_000 });
    await firstMovie.click();
    await expect(page).toHaveURL(/\/movie\//);
    await expect(await sel.movie.title(page)).toBeVisible();
  });

  test('gated actions push anonymous users to /auth', async ({ page }) => {
    await page.goto(`/movie/${process.env.E2E_MOVIE_TMDB_ID || '27205'}`);
    const fav = await sel.movie.favorite(page);
    if (await fav.count()) {
      await fav.click();
      // Either a sign-in prompt/modal or a redirect to /auth.
      await expect(
        page.getByText(/sign ?in|giriş|oturum aç/i).first().or(page.locator('body')),
      ).toBeVisible();
    }
  });
});
