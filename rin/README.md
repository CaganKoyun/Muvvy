# Spark Retail Identity Network (RIN)

> **One Identity. Every Store.**
> The identity & consent layer for physical commerce — *"Continue with Spark"*, the
> in-store equivalent of *"Sign in with Apple"*.

A customer identifies **once** and shops seamlessly across every participating
merchant with a single trusted identity. Retailers keep their existing CRM, POS
and ERP and instantly onboard **verified, consented** customers. This repository
is a working, verified implementation of the platform from the PRD, built as a
**modular monolith** (NestJS + TypeORM + PostgreSQL) whose bounded contexts split
into services with no domain rewrite.

Everything below runs end-to-end with **zero external dependencies** (in-memory
SQLite) and is exercised by a self-asserting demo and two e2e suites — verified on
both **SQLite** and **PostgreSQL 16**.

---

## What's implemented

**Identity**
- "Continue with Spark" — email/password, **passkeys (WebAuthn, real ES256)**, and
  **social login (OIDC)** — all resolving to one Spark identity reused across stores.
- Merchants authenticate via OAuth2 `client_credentials`.

**Consent (the heart)**
- The Consent Engine (granular required/optional scopes) and the QR handshake:
  request → consent screen → granular approval → merchant receives *only* the
  consented fields. One-click, revocable, fully audited.

**Receipts & Wallet**
- Digital receipts (POS → wallet), auto-attached warranties, return windows,
  gift cards / coupons / loyalty & membership cards, purchase timeline.

**Engagement**
- **Consent-safe campaigns** (a customer who declined marketing is provably never
  targeted), membership tiers & points, and a customer Notification Center with
  warranty-expiry reminders.

**Mall**
- Mall-wide identity dashboard (identified shoppers across member stores,
  participation, cross-store shoppers, campaign reach).

**Integrations**
- Webhooks (HMAC-signed, retried, logged) **and** a connector framework
  (CRM/POS/ERP Integration Gateway) that normalizes events, plus **CSV import**.

**Surfaces & platform**
- REST (**OpenAPI at `/docs`**) **and GraphQL at `/graphql`** (one-round-trip
  consumer graph). Multi-tenant RBAC, event-driven backbone (**swappable
  in-process ↔ NATS**), append-only audit log, idempotent APIs, RFC7807 errors.

### Enforced & verified guarantees

| Property | How it's enforced |
|---|---|
| Granular consent | Merchant receives *only* granted scopes; declined fields are never read |
| Consent boundaries | Can't grant an un-requested scope; can't finish without required scopes |
| Consent-safe marketing | Campaigns skip customers who didn't grant the required permission |
| Revocability | Revoke → merchant reads return `revoked`, `ConsentChanged` fires |
| Tenant isolation | A merchant gets `404` for another merchant's customer |
| No cross-merchant linking | The raw Spark id is never disclosed; merchants key on a per-grant id |
| Real passkeys | ES256 attestation/assertion verified; forged signatures rejected |
| Signed delivery | Webhooks carry `X-Spark-Signature: sha256=…` (HMAC over the body) |
| Idempotency | `Idempotency-Key` → at-most-once execution with replayed responses |
| Auditability | Every consent decision & disclosure is written to `audit_log` |

---

## Quick start

```bash
cd rin
npm install
npm run demo        # full end-to-end story + ~45 assertions (spins up its own webhook sink)
```

`npm run demo` boots the app in-process, seeds a retailer (LC Waikiki) and a
customer (Ahmet), and walks the **entire** platform over the real HTTP/GraphQL
APIs — including a software passkey authenticator producing genuine ES256
signatures. It exits non-zero on any failure, so it doubles as a smoke test.

### Explore the API

```bash
npm run build && DB_DRIVER=sqlite DB_SQLITE_PATH=:memory: npm run start:prod
# REST + OpenAPI : http://localhost:3000/docs
# GraphQL        : http://localhost:3000/graphql
```

### Production target — PostgreSQL

```bash
docker compose up -d          # Postgres 16 on :5432
cp .env.example .env          # DB_DRIVER=postgres by default
npm run seed                  # prints merchant credentials + customer login
npm run start:dev
```

The **same code and entities** run on both drivers (verified on Postgres 16 and
SQLite); the model avoids driver-specific types on purpose.

---

## API surface (highlights)

`consumer` = Spark consumer token · `merchant` = OAuth2 client-credentials token.

| Area | Endpoints | Auth |
|---|---|---|
| Identity | `POST /v1/auth/register\|login`, `GET /v1/auth/me` | consumer |
| Passkeys | `POST /v1/auth/passkey/{register,login}/{options,verify}` | mixed |
| Social | `POST /v1/auth/social` | public |
| Merchant auth | `POST /oauth/token` (client_credentials) | client creds |
| Profile | `GET/PUT /v1/me/profile` | consumer |
| Consent config | `GET/PUT /v1/merchant/consent-config` | merchant |
| Handshake | `POST /v1/identity/requests`, `GET /v1/identity/requests/:id` | merchant |
| Consent | `GET /v1/consent/requests/:token`, `POST …/approve\|deny` | consumer |
| Consent Center | `GET /v1/consent/grants`, `POST /v1/consent/grants/:id/revoke` | consumer |
| Customers | `GET /v1/customers`, `GET /v1/customers/:grantId` | merchant |
| Receipts/Wallet | `POST /v1/receipts`, `POST /v1/wallet/issue`, `GET /v1/me/{receipts,warranties,wallet,timeline}` | mixed |
| Campaigns/Members | `POST/GET /v1/campaigns`, `POST/GET /v1/memberships`, `GET /v1/me/memberships` | mixed |
| Notifications | `GET /v1/me/notifications`, `POST …/:id/read`, `POST …/refresh-warranties` | consumer |
| Mall | `GET /v1/malls`, `GET /v1/malls/:id/dashboard`, `GET /v1/me/malls` | mixed |
| Connectors | `POST/GET /v1/connectors`, `GET /v1/connectors/:id/logs`, `POST /v1/connectors/import/receipts` | merchant |
| Webhooks | `POST/GET /v1/webhooks/endpoints`, `GET /v1/webhooks/deliveries` | merchant |
| Dashboard | `GET /v1/merchant/dashboard` | merchant |
| GraphQL | `POST /graphql` — `{ me { … } }` | consumer |
| Health | `GET /healthz` | — |

Full schemas: **`/docs`** (OpenAPI). Scopes (Consent Engine): `profile:{name,email,phone,birthday,gender,address}`, `permission:{marketing,sms,location,analytics}`.

Webhook / connector events: `CustomerCreated`, `CustomerUpdated`, `ConsentChanged`,
`IdentityVerified`, `ReceiptUploaded`, `WalletItemIssued`, `CampaignCreated`.

---

## Project layout

```
rin/src/
├─ config/                    # typed config + portable TypeORM datasource (pg | sqlite)
├─ common/
│  ├─ scopes.ts               # Consent Engine data dictionary
│  ├─ auth/                   # JWT + consumer & merchant guards (multi-tenant)
│  ├─ events/                 # event bus + swappable transport (inproc | NATS)
│  ├─ webauthn/               # self-contained CBOR + ES256 WebAuthn + demo authenticator
│  ├─ audit/  idempotency/  errors/  orm/  health/
├─ modules/
│  ├─ identity/               # Spark identity: password, passkeys, social (OIDC)
│  ├─ profile/                # customer-owned profile + disclosure resolver
│  ├─ merchant/               # tenant, client credentials, consent config, OAuth
│  ├─ consent/                # the handshake: identity_request + consent_grant
│  ├─ wallet/                 # receipts, warranties, gift cards, coupons, loyalty
│  ├─ notifications/          # Notification Center + warranty reminders
│  ├─ campaign/               # consent-safe campaigns + membership
│  ├─ mall/                   # mall-wide identity dashboard
│  ├─ connectors/             # CRM/POS/ERP Integration Gateway + CSV import
│  ├─ webhooks/               # HMAC-signed event delivery
│  └─ graphql/                # code-first GraphQL (consumer reads)
├─ seed/                      # shared seeder + `npm run seed`
└─ demo/                      # full self-contained end-to-end demo (`npm run demo`)
```

## Testing

```bash
npm run test:e2e     # 20 e2e tests (core handshake + extended flows), in-memory SQLite
npm run demo         # narrated end-to-end run + ~45 assertions
```

## Notes & simplifications

- **Passkeys** are implemented from first principles (a small CBOR + ES256
  verifier in `common/webauthn`) so the ceremony runs end-to-end with real
  signatures and no heavy dependency; swap in a FIDO metadata service for
  attestation-root validation in production.
- **Social login**: the `demo` provider (HS256) exercises the flow offline; the
  `google`/`apple` providers verify real RS256 tokens against provider JWKS.
- **Event transport** defaults to in-process; `EVENT_TRANSPORT=nats` activates the
  NATS adapter (publishers/subscribers unchanged).
- `synchronize: true` builds the schema from entities for the demo; use TypeORM
  migrations in production.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the design, data model, event
flow, and how each context becomes a service.
