# Muvvy — Playwright functional test suite

End-to-end functional tests for the features you asked for: **arama (search),
liste ekleme (lists), yorum (reviews/comments), beğeni (likes), mesaj (messages)
ve cowatch (Birlikte İzle)** — plus an anonymous smoke test.

> **Why this is a standalone folder.** Muvvy's own app source isn't in this
> repo (only the audit docs are), and this sandbox's egress proxy resets a real
> browser's TLS to every external HTTPS host **and** blocks WebSocket upgrades —
> so `muvvy.now` can't be driven from here. This suite is written to run in **any
> environment where a browser can reach the app** (your machine, a Lovable
> preview, or CI). Drop it into the Muvvy repo (or keep it beside it) and run.

---

## Two run modes

| Mode | Target | Needs | What it proves |
|------|--------|-------|----------------|
| **live** (default) | real backend (`muvvy.now` or local dev + real Supabase) | 1–2 throwaway accounts | true end‑to‑end incl. two‑user message/co‑watch round‑trips |
| **mock** | local dev server, Supabase REST/Edge intercepted | nothing | UI flows + optimistic writes, deterministic, offline, no creds |

Realtime (Supabase WebSocket) can't be fixtured, so **mock mode** covers the
sender side; the **live** two‑user specs cover real delivery.

---

## Quick start

```bash
cd muvvy-e2e
npm install
npx playwright install chromium        # skip if a Playwright browser is already present
cp .env.example .env                    # then edit .env
```

### Run against live prod (read‑only surface first — safe)

```bash
# Anonymous smoke + search only — writes nothing:
BASE_URL=https://muvvy.now E2E_READONLY=1 npm test
```

### Run the full authenticated suite (writes test data)

```bash
# Fill E2E_EMAIL/PASSWORD (+ _2 for messages/co-watch) in .env, then:
npm run test:live
```

### Run fully mocked (CI, no backend, no accounts)

```bash
# BASE_URL should point at a local Muvvy dev server (e.g. http://localhost:8080).
# Uncomment the `webServer` block in playwright.config.ts to auto-start it.
npm run test:mock
```

Reports: `npm run report` (HTML). Debug interactively: `npm run test:ui`.

---

## Configuration (`.env`)

See `.env.example`. Key vars:

- `BASE_URL` — app under test.
- `E2E_MODE` — `live` | `mock`.
- `E2E_EMAIL` / `E2E_PASSWORD` / `E2E_USERNAME` — account 1.
- `E2E_EMAIL_2` / … — account 2 (**required for `messages` and `cowatch`**; those
  specs auto‑skip without it).
- `E2E_READONLY=1` — run only non‑writing specs (anon smoke + search).
- `E2E_MOVIE_QUERY` / `E2E_MOVIE_TMDB_ID` — the movie used by search/list/review.

**Two‑user preconditions (live):** the two accounts must already be **friends**
(DMs and co‑watch invites require an accepted friendship — audit RLS). Make them
friends once, manually, before the first run.

---

## Making selectors bullet‑proof

Every selector lives in **`tests/_helpers/selectors.ts`** and tries, in order,
`data-testid` → ARIA role → visible text (TR+EN). Text is brittle across Muvvy's
7 locales, so the durable fix is to add `data-testid`s to the app. Highest‑value
ones:

```
nav-search  nav-messages  nav-user-menu
search-input  search-result-card
add-to-watchlist  toggle-favorite  add-to-list
review-input  review-submit  review-item
moment-card  moment-like  moment-like-count  moment-comment-input
message-input  message-send  message-bubble
cowatch-invite  cowatch-dialog  cowatch-friend-option  cowatch-confirm  cowatch-inbox-item
```

If a spec `test.skip`s with "confirm selector", add the matching `data-testid`
(or fix the entry in `selectors.ts`) and re‑run.

---

## What each spec asserts

| File | Feature | Notes |
|------|---------|-------|
| `smoke.anon.spec.ts` | anonymous shell, movie detail, gated‑action redirect | read‑only |
| `search.spec.ts` | **arama** — query → results → open detail | read‑only, anonymous |
| `lists.spec.ts` | **liste ekleme** — watchlist add, favorite idempotency, custom list | writes |
| `reviews.spec.ts` | **yorum** — post review, it lists, `myReview` re‑sync on reload | writes |
| `likes.spec.ts` | **beğeni** — like toggle + count, moment comment | writes |
| `messages.spec.ts` | **mesaj** — user1 → user2 DM round‑trip | 2 accounts, live |
| `cowatch.spec.ts` | **cowatch** — invite = schedule + .ics + chat | 2 accounts, live |

### Honesty baked in (from the pre‑prod audit)

`cowatch.spec.ts` asserts the **real** behavior: *Birlikte İzle* is a **viewing
appointment** (schedule + `.ics` + text chat), **not** synchronized playback, and
the invite does **not** push in realtime (receiver must refresh — audit C‑5). Two
`test.fixme` placeholders mark the gaps ("synced player", "realtime invite push")
so they're tracked but not falsely reported green. Flip them to real tests when
the feature is built.

Similarly, `couple/duel` remote multiplayer is intentionally **not** covered:
the audit found `useJoinByInvite`/`useCoupleSwipes` are never imported (no remote
join exists), so a passing test there would be fiction.
