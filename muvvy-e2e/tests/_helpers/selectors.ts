import type { Page, Locator } from '@playwright/test';

/**
 * ── SELECTOR MAP ────────────────────────────────────────────────────────────
 * Muvvy is TR-primary with i18n (en/tr/de/fr/it/es/hi), so text-based selectors
 * are brittle across locales. Every selector below tries, in order:
 *   1. a `data-testid`  (add these to the app for rock-solid tests — see README),
 *   2. an ARIA role + accessible name,
 *   3. visible text (TR + EN fallback).
 *
 * If a spec can't find an element, fix it HERE — one place, all specs benefit.
 * Grep the Muvvy source for the component names in comments to confirm markup.
 */

/** Try each locator in order; return the first that resolves to ≥1 element. */
export async function firstPresent(page: Page, candidates: Locator[]): Promise<Locator> {
  for (const c of candidates) {
    if (await c.count().catch(() => 0)) return c.first();
  }
  return candidates[0].first(); // let the assertion fail with a useful message
}

export const sel = {
  // ── Global nav / shell (Navbar.tsx) ──────────────────────────────────────
  nav: {
    home: (p: Page) => firstPresent(p, [
      p.getByTestId('nav-home'),
      p.getByRole('link', { name: /^(home|ana ?sayfa|keşfet için ana)/i }),
      p.locator('a[href="/"]').first(),
    ]),
    explore: (p: Page) => firstPresent(p, [
      p.getByTestId('nav-explore'),
      p.getByRole('link', { name: /explore|keşfet/i }),
      p.locator('a[href="/explore"], a[href="/discover"]').first(),
    ]),
    search: (p: Page) => firstPresent(p, [
      p.getByTestId('nav-search'),
      p.getByRole('link', { name: /search|ara(ma)?/i }),
      p.locator('a[href="/search"]').first(),
    ]),
    messages: (p: Page) => firstPresent(p, [
      p.getByTestId('nav-messages'),
      p.getByRole('link', { name: /messages|mesaj/i }),
      p.locator('a[href="/messages"], a[href^="/chat"]').first(),
    ]),
    signIn: (p: Page) => firstPresent(p, [
      p.getByTestId('nav-signin'),
      p.getByRole('link', { name: /sign ?in|giriş|oturum aç/i }),
      p.getByRole('button', { name: /sign ?in|giriş|oturum aç/i }),
      p.locator('a[href="/auth"]').first(),
    ]),
    avatar: (p: Page) => firstPresent(p, [
      p.getByTestId('nav-user-menu'),
      p.getByRole('button', { name: /account|profil|menu|hesap/i }),
      p.locator('header [role="button"] img, header button:has(img)').first(),
    ]),
  },

  // ── Auth (Auth.tsx) ───────────────────────────────────────────────────────
  auth: {
    email: (p: Page) => firstPresent(p, [
      p.getByTestId('auth-email'),
      p.getByRole('textbox', { name: /e-?mail|e-?posta/i }),
      p.locator('input[type="email"]').first(),
    ]),
    password: (p: Page) => firstPresent(p, [
      p.getByTestId('auth-password'),
      p.locator('input[type="password"]').first(),
    ]),
    submit: (p: Page) => firstPresent(p, [
      p.getByTestId('auth-submit'),
      p.getByRole('button', { name: /sign ?in|log ?in|giriş yap|oturum aç/i }),
    ]),
  },

  // ── Search (Search.tsx, route /search) ────────────────────────────────────
  search: {
    input: (p: Page) => firstPresent(p, [
      p.getByTestId('search-input'),
      p.getByRole('searchbox'),
      p.getByPlaceholder(/search|ara|film ara/i),
      p.locator('input[type="search"]').first(),
    ]),
    results: (p: Page) => firstPresent(p, [
      p.getByTestId('search-results'),
      p.getByRole('list', { name: /result|sonuç/i }),
      p.locator('[data-testid="search-result-card"], a[href^="/movie/"]'),
    ]),
    resultCard: (p: Page) => firstPresent(p, [
      p.getByTestId('search-result-card'),
      p.locator('a[href^="/movie/"], a[href^="/tv/"]'),
    ]),
  },

  // ── Movie detail (MovieDetail.tsx, route /movie/:id) ──────────────────────
  movie: {
    title: (p: Page) => firstPresent(p, [
      p.getByTestId('movie-title'),
      p.getByRole('heading', { level: 1 }),
    ]),
    // "Add to list" family: watchlist / favorite / custom list
    addToWatchlist: (p: Page) => firstPresent(p, [
      p.getByTestId('add-to-watchlist'),
      p.getByRole('button', { name: /watchlist|izleme listesi|listeye ekle/i }),
    ]),
    favorite: (p: Page) => firstPresent(p, [
      p.getByTestId('toggle-favorite'),
      p.getByRole('button', { name: /favorite|favori|beğen/i }),
    ]),
    addToCustomList: (p: Page) => firstPresent(p, [
      p.getByTestId('add-to-list'),
      p.getByRole('button', { name: /add to list|listeye ekle|koleksiyon/i }),
    ]),
    rate: (p: Page) => firstPresent(p, [
      p.getByTestId('rate-movie'),
      p.getByRole('button', { name: /rate|puan|değerlendir/i }),
    ]),
    coWatchCta: (p: Page) => firstPresent(p, [
      p.getByTestId('cowatch-invite'),
      p.getByRole('button', { name: /birlikte izle|co-?watch|watch together/i }),
    ]),
  },

  // ── Reviews / comments (MovieReviews.tsx) ─────────────────────────────────
  reviews: {
    textarea: (p: Page) => firstPresent(p, [
      p.getByTestId('review-input'),
      p.getByRole('textbox', { name: /review|yorum|inceleme/i }),
      p.getByPlaceholder(/review|yorum|ne düşün/i),
      p.locator('form textarea').first(),
    ]),
    submit: (p: Page) => firstPresent(p, [
      p.getByTestId('review-submit'),
      p.getByRole('button', { name: /post|gönder|paylaş|kaydet|yayınla/i }),
    ]),
    list: (p: Page) => firstPresent(p, [
      p.getByTestId('reviews-list'),
      p.locator('[data-testid="review-item"]'),
    ]),
    item: (p: Page) => firstPresent(p, [
      p.getByTestId('review-item'),
      p.locator('article:has(textarea), li:has([data-review-body])'),
    ]),
  },

  // ── Moments (MomentsReels.tsx) — likes + comments ─────────────────────────
  moments: {
    firstCard: (p: Page) => firstPresent(p, [
      p.getByTestId('moment-card'),
      p.locator('[data-moment-id]'),
      p.getByRole('article'),
    ]),
    like: (p: Page) => firstPresent(p, [
      p.getByTestId('moment-like'),
      p.getByRole('button', { name: /like|beğen/i }),
    ]),
    likeCount: (p: Page) => firstPresent(p, [
      p.getByTestId('moment-like-count'),
      p.locator('[data-like-count]'),
    ]),
    openComments: (p: Page) => firstPresent(p, [
      p.getByTestId('moment-comment-open'),
      p.getByRole('button', { name: /comment|yorum/i }),
    ]),
    commentInput: (p: Page) => firstPresent(p, [
      p.getByTestId('moment-comment-input'),
      p.getByPlaceholder(/comment|yorum yaz/i),
      p.locator('textarea, input[type="text"]').last(),
    ]),
    commentSubmit: (p: Page) => firstPresent(p, [
      p.getByTestId('moment-comment-submit'),
      p.getByRole('button', { name: /send|gönder|paylaş/i }),
    ]),
  },

  // ── Lists (PublicList.tsx, custom_lists / watchlist / favorites) ──────────
  lists: {
    watchlistItems: (p: Page) => firstPresent(p, [
      p.getByTestId('watchlist-item'),
      p.locator('a[href^="/movie/"]'),
    ]),
    createListButton: (p: Page) => firstPresent(p, [
      p.getByTestId('create-list'),
      p.getByRole('button', { name: /new list|liste oluştur|yeni liste/i }),
    ]),
    listNameInput: (p: Page) => firstPresent(p, [
      p.getByTestId('list-name-input'),
      p.getByRole('textbox', { name: /list name|liste adı|başlık/i }),
      p.locator('input[name="name"], input[name="title"]').first(),
    ]),
  },

  // ── Messages / chat (ChatThreadView.tsx, use-chat) ────────────────────────
  messages: {
    conversationList: (p: Page) => firstPresent(p, [
      p.getByTestId('conversation-list'),
      p.getByRole('list', { name: /conversation|sohbet|mesaj/i }),
    ]),
    composer: (p: Page) => firstPresent(p, [
      p.getByTestId('message-input'),
      p.getByRole('textbox', { name: /message|mesaj/i }),
      p.getByPlaceholder(/message|mesaj yaz/i),
      p.locator('form input[type="text"], form textarea').last(),
    ]),
    send: (p: Page) => firstPresent(p, [
      p.getByTestId('message-send'),
      p.getByRole('button', { name: /send|gönder/i }),
    ]),
    bubble: (p: Page) => firstPresent(p, [
      p.getByTestId('message-bubble'),
      p.locator('[data-message-id], [class*="bubble"]'),
    ]),
  },

  // ── Co-watch (CoWatch.tsx, CoWatchInviteDialog.tsx, use-co-watch) ─────────
  cowatch: {
    inviteDialog: (p: Page) => firstPresent(p, [
      p.getByTestId('cowatch-dialog'),
      p.getByRole('dialog', { name: /birlikte izle|co-?watch|watch together/i }),
      p.getByRole('dialog'),
    ]),
    pickFriend: (p: Page) => firstPresent(p, [
      p.getByTestId('cowatch-friend-option'),
      p.getByRole('option'),
      p.locator('[data-friend-id]'),
    ]),
    pickTime: (p: Page) => firstPresent(p, [
      p.getByTestId('cowatch-time'),
      p.locator('input[type="datetime-local"], input[type="time"]').first(),
    ]),
    confirmInvite: (p: Page) => firstPresent(p, [
      p.getByTestId('cowatch-confirm'),
      p.getByRole('button', { name: /invite|davet|başlayalım|planla|randevu/i }),
    ]),
    downloadIcs: (p: Page) => firstPresent(p, [
      p.getByTestId('cowatch-ics'),
      p.getByRole('button', { name: /\.ics|calendar|takvim/i }),
      p.getByRole('link', { name: /\.ics|calendar|takvim/i }),
    ]),
    inboxItem: (p: Page) => firstPresent(p, [
      p.getByTestId('cowatch-inbox-item'),
      p.locator('[data-invite-id]'),
    ]),
  },

  // ── Toast (sonner) — used to confirm mutations succeeded ──────────────────
  toast: (p: Page) => firstPresent(p, [
    p.locator('[data-sonner-toast]'),
    p.getByRole('status'),
    p.locator('[role="status"], .toast'),
  ]),
};
