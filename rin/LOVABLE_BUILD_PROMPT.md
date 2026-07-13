# Spark Retail Identity Network (RIN) — Lovable Build Prompt

> **How to use this file.** This is a *paste-ready specification for Lovable*, not
> source code. Lovable builds **React (Vite + TypeScript + Tailwind + shadcn/ui) +
> Supabase** — it cannot run the NestJS backend in the `rin/` project. That NestJS
> project is the **reference implementation**: its data model, consent handshake,
> scope catalog and business rules are translated below onto Supabase (Postgres +
> RLS + Auth + Edge Functions).
>
> **Paste one PHASE at a time** into Lovable (in order). Run/verify each before the
> next. Security lives in **RLS + Edge Functions**, never in the client.

---

## PHASE 0 — Product & stack

Build **Spark Retail Identity Network (RIN)**: an identity & consent layer for
physical retail. *"One identity, every store"* — a shopper identifies **once**
("Continue with Spark") and each merchant instantly receives **only the customer
data the shopper explicitly consented to**, without the merchant replacing its
CRM/POS/ERP.

There are two kinds of user:
- **Consumers** (shoppers) — authenticate with Supabase Auth.
- **Merchants** (retailers) — server-to-server; authenticate with client
  credentials via an Edge Function that issues a short-lived merchant JWT.

Stack & conventions:
- React + Vite + TypeScript + Tailwind + shadcn/ui; Supabase for DB/Auth/Edge Functions.
- Every table has **RLS enabled and FORCED**. Default deny; add explicit policies.
- All privileged writes go through **SECURITY DEFINER** Postgres functions or Edge
  Functions — never client-side inserts into sensitive tables.
- Use a private schema helper pattern (`private.current_consumer_id()`,
  `private.is_merchant(merchant_id)`) for policy checks.

---

## PHASE 1 — Data model (Supabase Postgres + RLS)

Create these tables (uuid PKs, `created_at timestamptz default now()`), **RLS ON**.

**Identity & profile**
- `consumers` — mirrors `auth.users` (1:1 via `id = auth.uid()`); columns:
  `id (uuid, references auth.users)`, `phone text`, `status text default 'active'`.
- `consumer_profiles` — `consumer_id uuid unique`, `first_name`, `last_name`,
  `birthday date`, `gender text`, `address jsonb`.

**Merchant (tenant)**
- `merchants` — `name`, `slug text unique`, `category text`, `status`.
- `merchant_credentials` — `merchant_id`, `client_id text unique`,
  `client_secret_hash text`, `status`. (secret shown once at creation)
- `merchant_requested_fields` — `merchant_id`, `scope_key text`,
  `required boolean`, unique `(merchant_id, scope_key)`. This is the Consent Engine config.

**Consent (the heart)**
- `identity_requests` — `merchant_id`, `request_token text unique`,
  `requested_scopes text[]`, `required_scopes text[]`, `status text default 'pending'`
  (`pending|approved|denied|expired`), `consumer_id uuid null`, `granted_scopes text[] null`,
  `reference text`, `expires_at timestamptz`, `decided_at timestamptz null`.
- `consent_grants` — `merchant_id`, `consumer_id`, `granted_scopes text[]`,
  `status text default 'active'` (`active|revoked`), `revoked_at timestamptz null`,
  unique `(merchant_id, consumer_id)`. **The merchant identifies a customer by
  `consent_grants.id` — never by `consumer_id`** (no cross-merchant linking).

**Wallet, engagement, integrations** (later phases, create when you reach them)
- `receipts`, `receipt_items`, `warranties`, `wallet_items`
- `campaigns`, `memberships`, `notifications`
- `malls`, `mall_stores`
- `webhook_endpoints`, `webhook_deliveries`, `connectors`, `connector_sync_logs`
- `audit_log` (append-only), `idempotency_records`

**Scope catalog** (the Consent Engine dictionary) — store as a constant in the app
and validate against it:
`profile:name`, `profile:email`, `profile:phone`, `profile:birthday`,
`profile:gender`, `profile:address`, `permission:marketing`, `permission:sms`,
`permission:location`, `permission:analytics`.

**RLS policies (essential ones)**
- `consumers` / `consumer_profiles`: a consumer can select/update only their own row
  (`id = auth.uid()` / `consumer_id = auth.uid()`).
- `consent_grants`: a consumer can **select** and **revoke (update status)** only their
  own grants. **No client insert** — grants are created only by the approve function.
- `identity_requests`: a consumer may select a row by `request_token` (to view a
  pending request); **no client writes**.
- `merchants` / `merchant_requested_fields`: readable by the owning merchant only
  (enforced in Edge Functions via the merchant JWT, since merchants are not `auth.users`).
- Everything merchant-facing is reached through Edge Functions that verify the
  merchant JWT and scope every query by `merchant_id`.

---

## PHASE 2 — Authentication

**Consumers** — Supabase Auth:
- Enable **Email** (magic link or password) and **Google + Apple OAuth**
  ("Continue with Google/Apple" ⇒ the "Continue with Spark" experience).
- On first sign-in, upsert a `consumers` row (`id = auth.uid()`) and an empty
  `consumer_profiles` row (via a trigger `on auth.users insert`).
- *(Optional, advanced)* Passkeys/WebAuthn: Supabase Auth has no first-class passkey
  login yet, so add later as a custom Edge Function (`passkey-register`,
  `passkey-login`) using the WebAuthn ceremony from the NestJS reference
  (`rin/src/common/webauthn`). Ship social + email first.

**Merchants** — Edge Function `oauth-token`:
- Input `{ client_id, client_secret }`. Look up `merchant_credentials`, verify the
  secret against `client_secret_hash` (bcrypt), and return a short-lived **HS256
  merchant JWT** signed with a Supabase secret (`MERCHANT_JWT_SECRET`) containing
  `{ sub: merchant_id, typ: 'merchant' }`. Other merchant Edge Functions verify this JWT.

---

## PHASE 3 — The consent handshake (Edge Functions) ← the core

Implement the exact flow from the reference project. Four Edge Functions:

1. **`identity-request-create`** (merchant JWT) — creates an `identity_requests`
   row from the merchant's `merchant_requested_fields` (or an explicit
   `requested_scopes` override), a random `request_token`, `status='pending'`,
   `expires_at = now() + 5 min`. Returns `{ request_token, request_id, requested_scopes,
   required_scopes, qr: { deeplink: 'spark://join?rt=...' } }`. This is the QR the
   cashier shows.

2. **Consumer views** — client selects the `identity_requests` row by `request_token`
   (RLS allows read) and shows the **consent screen**: which merchant + each requested
   scope with a label, required vs optional.

3. **`consent-approve`** (consumer session, SECURITY DEFINER logic) — input
   `{ request_token, granted_scopes[] }`. Validate: `granted ⊆ requested` **and**
   `required ⊆ granted` (else 400). Upsert `consent_grants (merchant_id, consumer_id)`
   → active with `granted_scopes`. Set the request `approved`, `granted_scopes`,
   `decided_at`. Write `audit_log`. Fire the `CustomerCreated`/`IdentityVerified`
   webhook (Phase 6). Also a `consent-deny` function.

4. **`customer-get`** (merchant JWT) — input `{ request_id }` or `{ grant_id }`.
   If the grant is **active**, compute the **disclosure**: return **only** the fields
   named by `granted_scopes` (the resolver from `rin/src/modules/profile/profile.service.ts`
   → `resolveDisclosure`). If revoked, return `{ status: 'revoked' }`. **Never** return
   a scope that wasn't granted; **never** return the raw `consumer_id`.

**Disclosure resolver** (port this logic into `customer-get`):
`profile:email→consumers/auth email`, `profile:phone→phone`,
`profile:name→first+last`, `profile:birthday`, `profile:gender`, `profile:address`;
`permission:*→ boolean true`. Only include keys for granted scopes.

**Screens for Phase 3**
- **Consumer:** the consent screen (approve with per-scope toggles; required scopes
  locked on), and a **Consent Center** listing every connected store with a
  **one-click Revoke**.
- **Merchant dashboard:** create request (show QR), poll status, view the consented
  customer, and stats (new members, consent rate, avg checkout time).

**Acceptance criteria (verify before moving on)**
- Approving with a subset discloses exactly that subset; a declined field is absent.
- Approving a scope the merchant didn't request → rejected; missing a required scope → rejected.
- After revoke, `customer-get` returns `revoked`.
- Merchant A cannot read merchant B's grant (RLS + JWT scoping) → not found.
- The raw Spark `consumer_id` never appears in any merchant response.

---

## PHASE 4 — Receipts & Wallet

- `receipts` + `receipt_items`; a merchant Edge Function `receipt-upload` attaches a
  receipt to a customer **by `grant_id`** (only consented customers). Auto-create a
  `warranties` row for items with `warranty_months`; compute `return_by` from `return_days`.
- Consumer wallet screens: receipts, warranties (sorted by expiry), gift cards /
  coupons / loyalty & membership cards (`wallet_items`), purchase timeline.
- Merchant `wallet-issue` Edge Function to grant a coupon/gift card to a `grant_id`.

## PHASE 5 — Consent-safe campaigns, membership, notifications

- **Campaigns** (`campaign-create`, merchant): target **only** active grants whose
  `granted_scopes` include the required permission (default `permission:marketing`).
  A shopper who declined marketing is **provably never targeted** — surface
  `targeted` vs `suppressed` counts. Deliver as `notifications` rows.
- **Memberships**: tier + points per `(merchant, consumer)`.
- **Notification Center** (consumer): campaigns, coupons, warranty-expiry reminders
  (a scheduled function scanning `warranties`), mark-read.

## PHASE 6 — Integrations & Mall

- **Webhooks**: `webhook_endpoints` (+ HMAC secret). After consent/receipt events,
  POST a signed payload (`X-Spark-Signature: sha256=…`) to the merchant's endpoint
  (use `pg_net` or an Edge Function). **Do not include `consumer_id`** — use `grant_id`.
  Log to `webhook_deliveries`.
- **Connectors** (CRM/POS/ERP Integration Gateway): normalize events
  (`upsert_customer` / `consent_changed` / `receipt`) into `connector_sync_logs`;
  CSV import for bulk receipts.
- **Mall**: `malls` + `mall_stores`; a mall dashboard aggregating identified shoppers
  across member stores (distinct consumers with an active grant), participation, and
  campaign reach.

---

## Cross-cutting (apply throughout)
- **Audit** every consent decision & disclosure into `audit_log` (powers a
  Transparency Center for the consumer).
- **Idempotency**: accept an `Idempotency-Key` on mutating Edge Functions; store &
  replay via `idempotency_records`.
- **Privacy invariants** (must always hold): merchants receive only granted scopes;
  merchants never see each other's customers; the raw Spark identity id is never
  disclosed; revoke is immediate and one-click.

## Reference
The full working reference (data model, exact validation, disclosure resolver,
WebAuthn, webhook signing, tests) is the NestJS project in `rin/` — read
`rin/README.md` and `rin/ARCHITECTURE.md`. Use it to resolve any ambiguity while
building the Supabase version above.
