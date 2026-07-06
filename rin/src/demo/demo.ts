/* eslint-disable no-console */
/**
 * End-to-end proof of the Spark RIN core slice — the whole "Continue with Spark"
 * handshake driven over the real HTTP API, with a self-contained webhook sink.
 *
 *   npm run demo
 *
 * Defaults to an in-memory SQLite DB so it runs with zero external services.
 * Every step is asserted, so this doubles as a smoke test (exit code != 0 on
 * any failure).
 */
import 'reflect-metadata';
import * as http from 'http';
import { createHmac } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import { AppModule } from '../app.module';
import { ProblemDetailsFilter } from '../common/errors/problem.filter';
import { seed } from '../seed/seed-data';

// Run against in-memory SQLite unless the caller configured a real DB.
process.env.DB_DRIVER = process.env.DB_DRIVER ?? 'sqlite';
process.env.DB_SQLITE_PATH = process.env.DB_SQLITE_PATH ?? ':memory:';

const PORT = Number(process.env.DEMO_PORT ?? 3210);
const SINK_PORT = Number(process.env.DEMO_SINK_PORT ?? 3211);
const BASE = `http://localhost:${PORT}`;
const SINK_URL = `http://localhost:${SINK_PORT}/crm/spark`;

interface Received {
  headers: http.IncomingHttpHeaders;
  raw: string;
  body: any;
}
const received: Received[] = [];

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`   ✓ ${msg}`);
  } else {
    failures++;
    console.log(`   ✗ FAIL: ${msg}`);
  }
}

function section(title: string): void {
  console.log(`\n${'━'.repeat(72)}\n▓ ${title}\n${'━'.repeat(72)}`);
}
function show(label: string, obj: unknown): void {
  console.log(`\n${label}:\n${JSON.stringify(obj, null, 2)}`);
}

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; idem?: string } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function startSink(): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          /* keep raw */
        }
        received.push({ headers: req.headers, raw: data, body: parsed });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    server.listen(SINK_PORT, () => resolve(server));
  });
}

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 4000): Promise<T | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  return undefined;
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.use(express.urlencoded({ extended: true }));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.listen(PORT);
  const sink = await startSink();

  try {
    section('0 · Seed — one retailer (LC Waikiki), one customer (Ahmet)');
    const seeded = await seed(app);
    show('Merchant credentials (client_credentials)', seeded.merchant);
    show('Customer login', seeded.consumer);

    // ── Merchant authenticates ────────────────────────────────────────────
    section('1 · Merchant obtains an access token (OAuth2 client_credentials)');
    const tok = await api('POST', '/oauth/token', {
      body: {
        grant_type: 'client_credentials',
        client_id: seeded.merchant.clientId,
        client_secret: seeded.merchant.clientSecret,
      },
    });
    show('POST /oauth/token', tok.body);
    check(tok.status === 200 && !!tok.body.access_token, 'merchant received a bearer token');
    const mToken = tok.body.access_token as string;

    // ── Merchant registers its CRM webhook ────────────────────────────────
    section('2 · Merchant registers a webhook (its CRM sink)');
    const wh = await api('POST', '/v1/webhooks/endpoints', {
      token: mToken,
      body: { url: SINK_URL },
    });
    show('POST /v1/webhooks/endpoints', { ...wh.body, secret: `${String(wh.body.secret).slice(0, 12)}…` });
    check(wh.status === 201 && !!wh.body.secret, 'webhook endpoint registered with a signing secret');
    const webhookSecret = wh.body.secret as string;

    // ── Cashier shows the QR ──────────────────────────────────────────────
    section('3 · Cashier: "Would you like to join?" → create identity request (QR)');
    const reqRes = await api('POST', '/v1/identity/requests', {
      token: mToken,
      body: { reference: 'POS-4471' },
      idem: 'demo-req-1',
    });
    show('POST /v1/identity/requests', reqRes.body);
    check(reqRes.status === 201 && reqRes.body.status === 'pending', 'pending request created');
    check(!!reqRes.body.qr?.deeplink, 'QR deeplink returned for the cashier screen');
    const requestToken = reqRes.body.requestToken as string;
    const requestId = reqRes.body.requestId as string;

    // Idempotency: same key returns the same request, not a new one.
    const reqDup = await api('POST', '/v1/identity/requests', {
      token: mToken,
      body: { reference: 'POS-4471' },
      idem: 'demo-req-1',
    });
    check(reqDup.body.requestId === requestId, 'idempotent retry returns the same request id');

    // ── Consumer logs in with Spark ───────────────────────────────────────
    section('4 · Customer: "Continue with Spark" → login');
    const login = await api('POST', '/v1/auth/login', {
      body: { email: seeded.consumer.email, password: seeded.consumer.password },
    });
    check(login.status === 200 && !!login.body.accessToken, 'customer authenticated');
    const cToken = login.body.accessToken as string;

    // ── Consumer sees exactly what is being asked ─────────────────────────
    section('5 · Consent screen — what is LC Waikiki asking for?');
    const view = await api('GET', `/v1/consent/requests/${requestToken}`, { token: cToken });
    show(`GET /v1/consent/requests/${requestToken.slice(0, 10)}…`, view.body);
    check(view.body.merchant?.name === 'LC Waikiki', 'customer sees the requesting merchant');
    check(view.body.requested?.length === 6, 'customer sees all 6 requested scopes');

    // ── Consumer approves a granular subset ───────────────────────────────
    section('6 · Customer approves — grants required + birthday, DECLINES gender & address');
    const approve = await api('POST', `/v1/consent/requests/${requestToken}/approve`, {
      token: cToken,
      body: {
        grantedScopes: ['profile:email', 'profile:phone', 'permission:marketing', 'profile:birthday'],
      },
    });
    show('POST …/approve', approve.body);
    check(approve.status === 201 && approve.body.status === 'approved', 'consent granted');
    check(approve.body.grantedScopes.length === 4, 'exactly 4 scopes granted');
    const grantId = approve.body.grantId as string;

    // ── Merchant receives the customer (only the granted slice) ───────────
    section('7 · Merchant reads the consented customer (POST /customer analog)');
    const result = await api('GET', `/v1/identity/requests/${requestId}`, { token: mToken });
    show(`GET /v1/identity/requests/${requestId.slice(0, 8)}…`, result.body);
    check(result.body.status === 'approved', 'merchant sees approved status');
    check(result.body.customer?.profile?.email === 'ahmet@example.com', 'merchant received email');
    check(result.body.customer?.profile?.phone === '+905551112233', 'merchant received phone');
    check(result.body.customer?.profile?.birthday === '1990-05-14', 'merchant received birthday');
    check(result.body.customer?.permissions?.marketing === true, 'merchant received marketing permission');
    check(
      result.body.customer?.profile?.gender === undefined,
      'PRIVACY: declined gender is NOT disclosed',
    );
    check(
      result.body.customer?.profile?.address === undefined,
      'PRIVACY: declined address is NOT disclosed',
    );

    // ── The CRM webhook fired ─────────────────────────────────────────────
    section('8 · Merchant CRM webhook: CustomerCreated delivered & HMAC-verified');
    const created = await waitFor(() =>
      received.find((r) => r.body?.type === 'CustomerCreated'),
    );
    check(!!created, 'CustomerCreated webhook was delivered to the CRM sink');
    if (created) {
      const expected = createHmac('sha256', webhookSecret).update(created.raw).digest('hex');
      const got = String(created.headers['x-spark-signature'] || '').replace('sha256=', '');
      check(got === expected, 'webhook HMAC-SHA256 signature verified');
      check(
        created.body.data?.customer?.profile?.email === 'ahmet@example.com',
        'webhook payload carries the consented data',
      );
      check(
        !JSON.stringify(created.body).includes(seeded.consumer.id),
        'PRIVACY: raw Spark identity id is NOT leaked to the merchant',
      );
      show('Webhook received by CRM', created.body);
    }

    // ── Merchant dashboard ────────────────────────────────────────────────
    section('9 · Merchant dashboard');
    const dash = await api('GET', '/v1/merchant/dashboard', { token: mToken });
    show('GET /v1/merchant/dashboard', dash.body);
    check(dash.body.newMembers === 1, 'dashboard shows 1 new member');
    check(dash.body.consentRate === 1, 'consent rate is 100%');
    check(dash.body.avgCheckoutSeconds !== null, 'checkout duration measured');

    // ── Consumer Consent Center ───────────────────────────────────────────
    section('10 · Customer Consent Center — every connected store');
    const center = await api('GET', '/v1/consent/grants', { token: cToken });
    show('GET /v1/consent/grants', center.body);
    check(center.body.grants?.length === 1, 'one active connection listed');

    // ── One-click revoke ──────────────────────────────────────────────────
    section('11 · Customer revokes consent (one click)');
    const revoke = await api('POST', `/v1/consent/grants/${grantId}/revoke`, { token: cToken });
    show('POST …/revoke', revoke.body);
    check(revoke.body.status === 'revoked', 'grant revoked');

    const afterRevoke = await api('GET', `/v1/customers/${grantId}`, { token: mToken });
    check(afterRevoke.body.status === 'revoked', 'merchant can no longer read the customer');
    const changed = await waitFor(() =>
      received.find((r) => r.body?.type === 'ConsentChanged'),
    );
    check(!!changed, 'ConsentChanged webhook delivered on revoke');

    // ── Cross-tenant isolation ────────────────────────────────────────────
    section('12 · Privacy: a different merchant cannot see this customer');
    const merchants2 = app.get(
      (await import('../modules/merchant/merchant.service')).MerchantService,
    );
    const rival = await merchants2.create('Rival Store', 'rival', 'fashion');
    const rivalCred = await merchants2.issueCredentials(rival.id);
    const rivalTok = await api('POST', '/oauth/token', {
      body: {
        grant_type: 'client_credentials',
        client_id: rivalCred.clientId,
        client_secret: rivalCred.clientSecret,
      },
    });
    const cross = await api('GET', `/v1/customers/${grantId}`, { token: rivalTok.body.access_token });
    check(cross.status === 404, 'rival merchant gets 404 for another merchant’s customer');

    // ── Consent boundary negative tests ───────────────────────────────────
    section('13 · Consent Engine boundaries (negative tests)');
    const req2 = await api('POST', '/v1/identity/requests', { token: mToken });
    const t2 = req2.body.requestToken as string;
    const extra = await api('POST', `/v1/consent/requests/${t2}/approve`, {
      token: cToken,
      body: { grantedScopes: ['profile:email', 'profile:phone', 'permission:marketing', 'permission:location'] },
    });
    check(extra.status === 400, 'cannot grant a scope the merchant did not request');

    const missing = await api('POST', `/v1/consent/requests/${t2}/approve`, {
      token: cToken,
      body: { grantedScopes: ['profile:email'] },
    });
    check(missing.status === 400, 'cannot complete without the required scopes');

    // ── Verdict ───────────────────────────────────────────────────────────
    section(failures === 0 ? '✅ DEMO PASSED — all assertions green' : `❌ DEMO FAILED — ${failures} assertion(s) failed`);
  } finally {
    sink.close();
    await app.close();
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
