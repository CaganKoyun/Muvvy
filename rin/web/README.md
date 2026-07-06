# Spark RIN — Lovable app (React + Supabase)

> **One Identity. Every Store.** The identity & consent layer for physical
> commerce, built the way **Lovable** builds: **React + Vite + TypeScript +
> Tailwind** frontend on a **Supabase** backend (Postgres + RLS + Auth + Edge
> Functions). This is the codebase to continue in Lovable.

The flow: a **brand** signs in → picks a **branch** → the branch shows a
**branded QR** → the shopper scans → a **branded consent screen** (brand logo +
branch) → the shopper approves granular scopes → the brand appears in the
shopper's **app** and lands as a verified member in the brand's **dashboard**,
routed into the brand's **primary CRM/POS/ERP**.

## Architecture (Supabase-native)

- **Auth** — Supabase Auth for everyone. `profiles.role` is `consumer` or
  `brand`; brand staff link to a merchant via `merchant_members`.
- **RLS is FORCED on every table.** Shoppers see only their own rows; brand staff
  see only their merchant's (via `app.is_member`).
- **The handshake + all privileged/cross-tenant logic are SECURITY DEFINER
  Postgres functions (RPCs)** — `create_identity_request`, `get_consent_request`,
  `approve_consent`, `get_customer`, `revoke_grant`, `merchant_dashboard`,
  `send_campaign`, `upload_receipt`, `my_connected_brands`, `mall_dashboard`, …
- **The privacy boundary lives in `get_customer` / `list_customers`:** a brand
  receives only the consented scopes and a per-grant handle — **never** the raw
  Spark identity id, so brands cannot correlate a shopper across each other.
- **Edge Functions** (`supabase/functions`) cover the machine/outbound paths:
  `pos-request` (a POS terminal creates a branded request via an API key) and
  `sync-primary` (routes a consented customer into the brand's primary connector,
  HMAC-signed).

```
src/                       React app (Vite + TS + Tailwind)
  supabase.ts              Supabase client
  AuthContext.tsx          session + role
  db.ts                    every backend call (RPC + RLS reads) in one adapter
  pages/dashboard/*        brand: overview, branches, brand&consent, QR, customers,
                           integrations, campaigns, malls
  pages/app/*              shopper: continue-with-spark, branded consent, brands,
                           wallet, alerts, profile & transparency
supabase/
  migrations/              0001 schema · 0002 RLS + RPCs · 0003 extra RPCs
  functions/               pos-request, sync-primary, _shared
  seed.sql                 demo brand + branch + branding + shopper
  config.toml
```

## Run it

### With Lovable
Open this project in Lovable and connect a Supabase project. Lovable applies the
`supabase/migrations` and picks up the React app; keep building screens/flows —
the schema, RLS and RPCs are already in place.

### Locally (Supabase CLI)
```bash
supabase start                     # local Postgres + Auth + Edge runtime (needs Docker)
supabase db reset                  # applies migrations/ + seed.sql
cp .env.example .env               # set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install && npm run dev         # http://localhost:5173
supabase functions serve           # (optional) pos-request, sync-primary
```

Seed logins (password `password123`): brand `owner@lcwaikiki.com`, shopper `ahmet@example.com`.

## Verified

The entire backend (schema + RLS + RPCs) was applied to Postgres 16 and exercised
with two simulated users (brand + shopper): branded consent → granular approval →
brand reads **only the granted fields** (declined ones absent, and the raw
identity id provably **not** disclosed) → consent-safe campaign (marketing
delivered, SMS suppressed) → revoke → RLS isolation. The React app builds clean
and its `db.ts` maps 1:1 to those verified RPCs. Live end-to-end needs a Supabase
project (Lovable provides one).

## Reference
A full NestJS reference implementation of the same domain lives in the parent
`rin/` folder (`rin/README.md`, `rin/ARCHITECTURE.md`) — use it to resolve any
ambiguity while extending the Supabase version.
