# Spark RIN — Architecture

## 1. Shape: a modular monolith that splits into services

The PRD calls for ~10 bounded contexts, event-driven, multi-tenant, at global
scale. Building 10 empty microservices on day one buys latency and ops overhead
before there is a single working flow. So this slice is a **modular monolith**:
each bounded context is its own NestJS module with its **own entities, service,
and controllers**, talking to peers only through **service interfaces** and the
**domain event bus** — never by reaching into another module's tables.

That discipline means each module lifts out into a standalone service with a
mechanical change (swap the in-process `EventBus` for a broker client, and the
direct service calls for HTTP/gRPC) — no domain rewrite.

```
                    ┌─────────────────────────────────────────────┐
   Consumer app ───►│  Identity   Profile        (consumer plane)  │
                    │     │          │                             │
                    │     ▼          ▼                             │
                    │  ┌───────────────────────┐                  │
   Merchant  ──────►│  │       Consent          │◄── Merchant      │
   backend          │  │  (identity_request,    │    (tenant plane)│
                    │  │   consent_grant)       │                  │
                    │  └───────────┬───────────┘                  │
                    │              │ publishes                     │
                    │        ┌─────▼──────┐                        │
                    │        │  EventBus  │  ← Kafka/NATS seam      │
                    │        └─────┬──────┘                        │
                    │              │ subscribes                    │
                    │         ┌────▼─────┐                         │
   Merchant CRM ◄───┼─────────│ Webhooks │  (signed delivery)      │
                    │         └──────────┘                         │
                    │   Cross-cutting: Auth · Audit · Idempotency  │
                    └─────────────────────────────────────────────┘
```

## 2. Bounded contexts

| Context | Owns | Key entities | Splits into |
|---|---|---|---|
| **Identity** | The Spark consumer identity & login | `consumer` | Identity Service |
| **Profile** | Customer-owned PII + the disclosure resolver (privacy boundary) | `consumer_profile` | Customer Profile Service |
| **Merchant** | Tenant, OAuth2 client credentials, Consent Engine config, dashboard reads | `merchant`, `merchant_credential`, `merchant_requested_field` | Merchant Service |
| **Consent** | The handshake + durable grants (the heart) | `identity_request`, `consent_grant` | Consent Service |
| **Webhooks** | Signed event delivery + delivery ledger | `webhook_endpoint`, `webhook_delivery` | Integration Gateway |
| **Common/Auth** | Token issue/verify, consumer & merchant guards | — | shared lib / gateway |
| **Common/Audit** | Append-only trail (KVKK/GDPR, Transparency Center) | `audit_log` | Audit Service |
| **Common/Events** | Domain event backbone | — | Kafka/NATS |
| **Common/Idempotency** | At-most-once mutation | `idempotency_record` | shared middleware |

Dependency direction is acyclic: `Consent → Merchant`, `Consent → Profile`,
`Profile → Identity`, and everything → the global `Auth/Audit/Events` layer.
`Webhooks` depends on nothing outbound; it only *subscribes* to events.

## 3. The data model

```
consumer ──1:1── consumer_profile
   │
   └──< consent_grant >── merchant ──< merchant_credential
                              │       └< merchant_requested_field   (Consent Engine config)
identity_request >── merchant
   (one handshake attempt; on approve → upserts the consent_grant)

webhook_endpoint >── merchant        webhook_delivery >── (endpoint, event)
audit_log        (actor, action, merchant?, consumer?, resource)
idempotency_record (key, method, path → stored response)
```

- **`consent_grant`** is the durable "this store may use these fields" relationship,
  unique per `(merchant, consumer)`, `active | revoked`. A merchant only ever sees a
  customer *through* an active grant, and identifies them by **grant id** — the raw
  `consumer.id` is never disclosed, so two merchants cannot correlate the same person.
- **`identity_request`** is a single QR/handshake attempt (`pending → approved/denied/expired`),
  analogous to an OAuth authorization request; `requestToken` is what the QR encodes.

### Portability

Entities avoid driver-specific types so one model runs on **PostgreSQL** (production)
and **SQLite** (demo/CI): UUID PKs are generated in-app, arrays use TypeORM
`simple-array`, JSON uses `simple-json`, and custom timestamps use an ISO-string
`ValueTransformer` (`common/orm/datetime.transformer.ts`). Verified against Postgres 16
and better-sqlite3.

## 4. The consent flow (authoritative sequence)

1. **Merchant** `POST /v1/identity/requests` → creates a `pending` `identity_request`
   from its Consent Engine config (or an explicit scope override), returns a
   `requestToken` + QR payload.
2. **Consumer** `GET /v1/consent/requests/:token` → sees the merchant and the exact
   scopes, each described and flagged required/optional.
3. **Consumer** `POST …/approve { grantedScopes }` → validated: granted ⊆ requested,
   and required ⊆ granted. Upserts the `consent_grant`, marks the request `approved`,
   writes an audit row, and publishes `IdentityVerified` + `CustomerCreated|Updated`.
4. **Merchant** `GET /v1/identity/requests/:id` (or the webhook) → receives the
   disclosure, **resolved fresh** from the profile against the granted scopes, so it
   always reflects the current grant (revocation included).
5. **Consumer** `POST /v1/consent/grants/:id/revoke` → grant `revoked`, `ConsentChanged`
   published; subsequent merchant reads return `revoked`.

The **privacy boundary** is `ProfileService.resolveDisclosure(consumerId, grantedScopes)`:
it only ever reads the fields named by the granted scopes, so an un-granted field is
structurally impossible to leak.

## 5. Multi-tenancy & RBAC

Two token audiences, both HS256 JWTs (`common/auth`):

- **Consumer token** (`typ: consumer`, `sub: consumerId`) — the `ConsumerGuard` attaches
  `req.consumer`.
- **Merchant token** (`typ: merchant`, `sub: merchantId`, `role`) — issued by the OAuth2
  `client_credentials` grant; the `MerchantGuard` attaches `req.merchant`.

Every merchant query is scoped by `merchant.id` from the token; cross-tenant reads
return `404`. This is the enforcement point that later moves into the API gateway.

## 6. Eventing & delivery

`EventBus` (an in-process `EventEmitter` wrapper) is published to synchronously from
the request path but **dispatches on the next tick**, so a slow/failing subscriber
never blocks or fails the user's request. `WebhookDispatcher` subscribes every event
type and fans out to that tenant's endpoints; `WebhookService` signs the body
(HMAC-SHA256), POSTs with a timeout, retries with backoff, and records every attempt
in `webhook_delivery`.

**To scale:** replace `EventBus.publish/subscribe` with a Kafka/NATS client and move
`WebhookDispatcher` into the Integration Gateway service. Publishers and subscribers
don't change — they already depend only on the `EventBus` interface and `DomainEvent`
shape.

## 7. Cross-cutting guarantees

- **Idempotency** — `Idempotency-Key` on a mutating request reserves a row (unique
  index breaks races), runs once, stores the response, and replays it on retry.
- **Audit** — consent granted/updated/revoked, denials, and request creation are all
  recorded with actor, resource, and metadata; `AuditService.forConsumer` powers the
  Transparency Center.
- **Errors** — a single `ProblemDetailsFilter` renders RFC7807 `problem+json`.
- **Validation** — global `ValidationPipe` with `whitelist + forbidNonWhitelisted`
  rejects unknown fields; scope values are validated against the catalog.

## 8. What changes for global scale (not in this slice)

- Broker (Kafka/NATS) + dead-letter queue behind the `EventBus` seam.
- Split read models for dashboards/analytics (CQRS) instead of aggregating on read.
- TypeORM migrations replace `synchronize`.
- Passkey/WebAuthn + social IdPs attach to `consumer` (identity model already allows it).
- Horizontal scale-out per context; the gateway owns token verification + tenant scoping.
