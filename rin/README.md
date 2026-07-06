# Spark Retail Identity Network (RIN)

> **One Identity. Every Store.**
> The identity & consent layer for physical commerce — *"Continue with Spark"*, the
> in-store equivalent of *"Sign in with Apple"*.

This repository holds the **MVP core slice** of the RIN platform described in the
PRD: a working, end-to-end implementation of the **Continue-with-Spark handshake**
— identity, granular consent, and the moment a merchant's CRM receives a verified
customer profile **without any retailer system being replaced**.

It is a **modular monolith** (NestJS + TypeORM + PostgreSQL) laid out as separable
bounded contexts, so it runs as one deployable today and splits into services later
without rewrites.

---

## What this slice does (and proves)

A cashier shows a QR → the customer taps *Continue with Spark*, sees exactly what
this store is asking for, and approves a **granular subset** → the merchant's CRM
instantly receives **only the consented fields**, over both a pull API and a
signed webhook. The customer can **revoke in one click**, and the merchant loses
access immediately.

Every one of these properties is enforced in code and asserted by the demo/tests:

| Property | How it's enforced |
|---|---|
| Granular consent | Merchant receives *only* granted scopes; declined fields are never read (`ProfileService.resolveDisclosure`) |
| Consent boundaries | Can't grant an un-requested scope; can't finish without required scopes |
| Revocability | `POST /consent/grants/:id/revoke` → merchant reads return `revoked`, `ConsentChanged` webhook fires |
| Tenant isolation | A merchant gets `404` for another merchant's customer |
| No cross-merchant linking | The raw Spark identity id is **never** sent to a merchant; merchants key on a per-grant id |
| Signed delivery | Webhooks carry `X-Spark-Signature: sha256=…` (HMAC over the body) |
| Idempotency | `Idempotency-Key` header → at-most-once execution with replayed responses |
| Auditability | Every consent decision & disclosure is written to an append-only `audit_log` |

---

## Quick start

### 1) Zero-setup demo (in-memory SQLite)

```bash
cd rin
npm install
npm run demo
```

`npm run demo` boots the app in-process, **spins up its own webhook sink**, seeds
one retailer (LC Waikiki) and one customer (Ahmet), then walks the entire handshake
over the real HTTP API — printing each step and asserting the outcome. It exits
non-zero if anything is wrong, so it doubles as a smoke test.

### 2) Run the server + explore the API

```bash
npm run build && DB_DRIVER=sqlite DB_SQLITE_PATH=:memory: npm run start:prod
# open http://localhost:3000/docs   (OpenAPI / Swagger UI)
```

### 3) Production target — PostgreSQL

```bash
docker compose up -d          # Postgres 16 on :5432
cp .env.example .env          # DB_DRIVER=postgres by default
npm run seed                  # prints merchant client credentials + customer login
npm run start:dev
```

The **same code and entities** run on both drivers (verified against Postgres 16
and SQLite); the model avoids driver-specific types on purpose.

---

## The handshake, end to end

```
Cashier                Customer (Spark app)            Merchant backend            Merchant CRM
  │                          │                               │                          │
  │ POST /oauth/token ───────┼──────────────────────────────►│ (client_credentials)     │
  │ POST /v1/identity/requests ──────────────────────────────►│  → { requestToken, qr } │
  │  shows QR  ──────────────►│                               │                          │
  │                    scans, POST /v1/auth/login             │                          │
  │                    GET /v1/consent/requests/:token  ──────► sees merchant + scopes   │
  │                    POST …/approve { grantedScopes }  ─────► consent_grant created     │
  │                          │                               │  CustomerCreated  ───────►│ (signed webhook)
  │                          │           GET /v1/identity/requests/:id ──────────────────► only consented fields
  │                    POST …/grants/:id/revoke  ────────────► ConsentChanged  ──────────►│
```

---

## API surface

`Bearer` = Spark **consumer** token (from `/v1/auth/login`).
`Bearer` = merchant token (from `/oauth/token`) for merchant routes.

| PRD API | Endpoint | Auth |
|---|---|---|
| `POST /identity/login` | `POST /v1/auth/login`, `POST /v1/auth/register`, `GET /v1/auth/me` | consumer |
| (merchant auth) | `POST /oauth/token` (OAuth2 `client_credentials`) | client creds |
| `POST /customer` (profile owner) | `GET/PUT /v1/me/profile` | consumer |
| (Consent Engine config) | `GET/PUT /v1/merchant/consent-config` | merchant |
| (create handshake) | `POST /v1/identity/requests` | merchant |
| `POST /customer` (read) | `GET /v1/identity/requests/:id`, `GET /v1/customers`, `GET /v1/customers/:grantId` | merchant |
| `POST /consent` | `GET /v1/consent/requests/:token`, `POST …/approve`, `POST …/deny` | consumer |
| (Consent Center + revoke) | `GET /v1/consent/grants`, `POST /v1/consent/grants/:id/revoke` | consumer |
| `Campaign/Membership …` dashboard | `GET /v1/merchant/dashboard` | merchant |
| Webhooks | `POST/GET /v1/webhooks/endpoints`, `GET /v1/webhooks/deliveries` | merchant |
| health | `GET /healthz` | — |

Full request/response schemas live in the OpenAPI doc at **`/docs`**.

### Consent Engine — scope catalog

Scopes are the granular units a merchant asks for and a customer approves:

- **Profile (PII):** `profile:name`, `profile:email`, `profile:phone`, `profile:birthday`, `profile:gender`, `profile:address`
- **Permissions:** `permission:marketing`, `permission:sms`, `permission:location`, `permission:analytics`

A merchant marks each requested scope **required** or **optional** (PRD example:
required = email, phone, marketing; optional = birthday, gender, address).

### Webhook events

`CustomerCreated`, `CustomerUpdated`, `ConsentChanged`, `IdentityVerified` — delivered
to registered endpoints, HMAC-signed, with delivery attempts recorded in
`webhook_delivery`. The in-process event bus (`src/common/events`) is the single
seam to swap for Kafka/NATS/RabbitMQ.

---

## Project layout

```
rin/
├─ src/
│  ├─ config/                 # typed config + portable TypeORM datasource (pg | sqlite)
│  ├─ common/
│  │  ├─ scopes.ts            # the Consent Engine data dictionary
│  │  ├─ auth/                # JWT signing + consumer & merchant guards (multi-tenant)
│  │  ├─ events/              # domain event bus (Kafka/NATS seam)
│  │  ├─ audit/               # append-only audit log
│  │  ├─ idempotency/         # Idempotency-Key interceptor
│  │  └─ errors/              # RFC7807 problem+json filter
│  ├─ modules/
│  │  ├─ identity/            # Spark consumer identity + login
│  │  ├─ profile/             # customer-owned profile + disclosure resolver
│  │  ├─ merchant/            # tenant, client credentials, consent config, OAuth token
│  │  ├─ consent/             # the handshake: identity_request + consent_grant
│  │  └─ webhooks/            # signed event delivery to merchant CRMs
│  ├─ seed/                   # shared seeder + standalone `npm run seed`
│  └─ demo/                   # self-contained end-to-end demo (`npm run demo`)
└─ test/                      # Jest e2e (`npm run test:e2e`)
```

## Testing

```bash
npm run test:e2e     # 13 e2e assertions over the critical path (in-memory SQLite)
npm run demo         # narrated end-to-end run + assertions
```

## PRD coverage

**Implemented (Phase 1 core):** Identity Service, Consent Service (the Consent
Engine + handshake), Customer Profile Service, Merchant Service (tenant + OAuth2 +
config + dashboard), Webhook framework, event-driven backbone, multi-tenant RBAC,
idempotent APIs, audit logging, OpenAPI docs, privacy-by-design disclosure.

**Deferred (later phases, per PRD roadmap):** Receipt & Wallet Service, Passkey /
WebAuthn & social logins (the identity model is ready for them), GraphQL surface,
Kafka/NATS broker (bus abstraction is in place), mall features, POS/ERP/CRM
connectors, Analytics Service, notifications, admin portal, IaC.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the design, data model, and how
each context splits into a service.

## Known MVP simplifications

- Identity uses email/password; social login (Apple/Google), phone OTP and passkeys
  attach to the same `consumer` row later without model changes.
- Webhook retries are in-process with linear backoff (a broker + dead-letter queue
  is the Phase-2 upgrade at the `EventBus` seam).
- `synchronize: true` builds the schema from entities for the demo; production uses
  TypeORM migrations.
