import type { Page, Route } from '@playwright/test';

/**
 * MOCK MODE backend. Intercepts Supabase REST (`/rest/v1/*`), Edge Functions
 * (`/functions/v1/*`) and Auth (`/auth/v1/*`) so the UI can be driven with no
 * real backend and no credentials — ideal for CI and for testing optimistic UI.
 *
 * Caveat: Supabase Realtime is a WebSocket (`/realtime/v1`). Playwright can't
 * fixture a WS stream the way it routes HTTP, so live push (incoming chat
 * message, co-watch inbox pop) is NOT exercised here — the messages/co-watch
 * specs assert the SENDER side (optimistic render + REST insert) in mock mode
 * and are the ones you run in LIVE mode for the full two-user round-trip.
 */

const FAKE_USER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'e2e@muvvy.test',
  user_metadata: { username: 'e2e_user' },
};

const FAKE_SESSION = {
  access_token: 'e2e-fake-access-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'e2e-fake-refresh-token',
  user: FAKE_USER,
};

/** In-memory tables the mock mutates so reads reflect writes within a test. */
type Store = Record<string, any[]>;
function freshStore(): Store {
  return {
    reviews: [],
    moments: [{ id: 'm1', tmdb_id: 27205, body: 'Seed moment', like_count: 3, liked_by_me: false }],
    moment_likes: [],
    moment_comments: [],
    favorites: [],
    watchlist: [],
    custom_lists: [{ id: 'l1', name: 'Watch soon', item_count: 0 }],
    conversations: [{ id: 'c1', other_username: 'e2e_user_2', last_message: 'hey' }],
    messages: [],
    co_watch_invites: [],
    friendships: [{ user_id: FAKE_USER.id, friend_id: 'friend-2', username: 'e2e_user_2' }],
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });
}

export async function installSupabaseMock(page: Page) {
  const store = freshStore();

  // Pre-seed a session so the app boots authenticated.
  await page.addInitScript((session) => {
    try {
      // supabase-js persists under a project-scoped key; set a permissive one.
      const key = Object.keys(localStorage).find((k) => k.startsWith('sb-')) || 'sb-mock-auth-token';
      localStorage.setItem(key, JSON.stringify({ currentSession: session, expiresAt: session.expires_at }));
    } catch { /* ignore */ }
  }, FAKE_SESSION);

  // ── Auth ──
  await page.route(/\/auth\/v1\/(token|user|session).*/, (route) => {
    if (/\/user/.test(route.request().url())) return json(route, FAKE_USER);
    return json(route, FAKE_SESSION);
  });

  // ── Edge functions ── (tmdb-proxy, cinema-chat, start_conversation, etc.)
  await page.route(/\/functions\/v1\/([a-z-]+)/, (route) => {
    const fn = route.request().url().match(/\/functions\/v1\/([a-z-]+)/)?.[1] || '';
    if (fn === 'tmdb-proxy') {
      return json(route, {
        results: [
          { id: 27205, title: 'Inception', release_date: '2010-07-16', poster_path: '/x.jpg', vote_average: 8.4 },
          { id: 157336, title: 'Interstellar', release_date: '2014-11-07', poster_path: '/y.jpg', vote_average: 8.4 },
        ],
      });
    }
    return json(route, { ok: true, result: `mock:${fn}` });
  });

  // ── REST (PostgREST) ──
  await page.route(/\/rest\/v1\/([a-z_]+)(\?.*)?$/, async (route) => {
    const req = route.request();
    const table = req.url().match(/\/rest\/v1\/([a-z_]+)/)?.[1] || '';
    const method = req.method();
    const rows = (store[table] ??= []);

    if (method === 'GET') return json(route, rows);

    if (method === 'POST') {
      const payload = safeJson(req.postData());
      const inserted = Array.isArray(payload) ? payload : [payload];
      const withIds = inserted.map((r, i) => ({ id: `${table}-${rows.length + i + 1}`, ...r }));
      rows.push(...withIds);
      // Optimistic-UI features read the count back; keep moment like_count coherent.
      if (table === 'moment_likes') bump(store, 'moments', 'like_count', +1);
      return json(route, withIds, 201);
    }

    if (method === 'PATCH') {
      const patch = safeJson(req.postData());
      rows.forEach((r) => Object.assign(r, patch));
      return json(route, rows);
    }

    if (method === 'DELETE') {
      if (table === 'moment_likes') bump(store, 'moments', 'like_count', -1);
      store[table] = [];
      return json(route, []);
    }

    return json(route, []);
  });

  // ── Realtime WS: fail fast & quietly so the app falls back to REST reads. ──
  await page.route(/\/realtime\/v1\/.*/, (route) => route.abort());
}

function safeJson(s: string | null) {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
function bump(store: Record<string, any[]>, table: string, field: string, by: number) {
  const row = store[table]?.[0];
  if (row && typeof row[field] === 'number') row[field] += by;
}
