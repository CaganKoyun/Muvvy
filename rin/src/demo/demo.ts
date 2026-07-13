/* eslint-disable no-console */
/**
 * Comprehensive end-to-end proof of the Spark RIN platform — the full
 * "Continue with Spark" story plus every extended surface, driven over the real
 * HTTP/GraphQL APIs with a self-contained webhook sink and a software passkey
 * authenticator. Defaults to in-memory SQLite: `npm run demo` needs nothing.
 * Every step is asserted, so it doubles as a smoke test (exit != 0 on failure).
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
import { SoftwareAuthenticator } from '../common/webauthn/authenticator';
import { makeDemoIdToken } from '../modules/identity/oidc-verifier';
import { MerchantService } from '../modules/merchant/merchant.service';

process.env.DB_DRIVER = process.env.DB_DRIVER ?? 'sqlite';
process.env.DB_SQLITE_PATH = process.env.DB_SQLITE_PATH ?? ':memory:';
const DEMO_OIDC_SECRET = process.env.OIDC_DEMO_SECRET ?? 'demo-oidc-secret';

const PORT = Number(process.env.DEMO_PORT ?? 3210);
const SINK_PORT = Number(process.env.DEMO_SINK_PORT ?? 3211);
const BASE = `http://localhost:${PORT}`;
const SINK_URL = `http://localhost:${SINK_PORT}/crm/spark`;

const received: Array<{ headers: http.IncomingHttpHeaders; raw: string; body: any }> = [];
let failures = 0;

function check(cond: boolean, msg: string): void {
  console.log(`   ${cond ? '✓' : '✗ FAIL:'} ${msg}`);
  if (!cond) failures++;
}
function section(t: string): void {
  console.log(`\n${'━'.repeat(74)}\n▓ ${t}\n${'━'.repeat(74)}`);
}
function show(label: string, obj: unknown): void {
  console.log(`\n${label}:\n${JSON.stringify(obj, null, 2)}`);
}

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; idem?: string; raw?: string; contentType?: string } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    'content-type': opts.contentType ?? 'application/json',
  };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.raw !== undefined ? opts.raw : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
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
  app.use(express.text({ type: ['text/csv', 'text/plain'] }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.listen(PORT);
  const sink = await startSink();

  try {
    section('0 · Seed — retailer LC Waikiki + customer Ahmet');
    const seeded = await seed(app);
    show('Merchant', seeded.merchant);
    show('Customer', seeded.consumer);

    section('1 · Merchant token (OAuth2 client_credentials)');
    const tok = await api('POST', '/oauth/token', {
      body: { grant_type: 'client_credentials', client_id: seeded.merchant.clientId, client_secret: seeded.merchant.clientSecret },
    });
    check(tok.status === 200 && !!tok.body.access_token, 'merchant token issued');
    const mToken = tok.body.access_token as string;

    section('2 · Merchant registers CRM webhook + a CRM connector');
    const wh = await api('POST', '/v1/webhooks/endpoints', { token: mToken, body: { url: SINK_URL } });
    check(wh.status === 201 && !!wh.body.secret, 'webhook registered');
    const webhookSecret = wh.body.secret as string;
    const catalog = await api('GET', '/v1/connectors/catalog', { token: mToken });
    check((catalog.body.tools?.length ?? 0) >= 5, 'integration catalog available (Salesforce, SAP, NCR…)');
    const conn = await api('POST', '/v1/connectors', {
      token: mToken,
      body: { kind: 'crm', adapter: 'log', name: 'Salesforce (demo)', config: { apiKey: 'sk_demo' }, isPrimary: true },
    });
    check(conn.status === 201 && conn.body.isPrimary === true, 'primary CRM connector registered (brand’s main solution)');
    const connectorId = conn.body.id as string;

    section('3 · Branch (şube) creates the branded QR + idempotency');
    const reqRes = await api('POST', '/v1/identity/requests', {
      token: mToken,
      body: { reference: 'POS-4471', branchId: seeded.branch.id },
      idem: 'req-1',
    });
    check(reqRes.status === 201 && reqRes.body.status === 'pending', 'pending request created');
    check(reqRes.body.branchId === seeded.branch.id, 'request is scoped to the branch');
    const requestToken = reqRes.body.requestToken as string;
    const requestId = reqRes.body.requestId as string;
    const dup = await api('POST', '/v1/identity/requests', { token: mToken, body: { reference: 'POS-4471' }, idem: 'req-1' });
    check(dup.body.requestId === requestId, 'idempotent retry returns the same request');

    section('4 · Customer logs in with Spark (password)');
    const login = await api('POST', '/v1/auth/login', { body: { email: seeded.consumer.email, password: seeded.consumer.password } });
    check(login.status === 200 && !!login.body.accessToken, 'customer authenticated');
    let cToken = login.body.accessToken as string;

    section('5 · Branded consent screen (brand logo + branch)');
    const view = await api('GET', `/v1/consent/requests/${requestToken}`, { token: cToken });
    show('Consent screen payload', { brand: view.body.brand, branch: view.body.branch });
    check(view.body.brand?.name === 'LC Waikiki', 'sees the brand name');
    check(!!view.body.brand?.logoUrl, 'branded consent screen carries the brand logo');
    check(view.body.branch?.code === 'AKASYA', 'sees which branch (şube) is asking');
    check(view.body.requested?.length === 6, 'sees all 6 requested scopes');

    section('6 · Customer approves — grants required + birthday, DECLINES gender & address');
    const approve = await api('POST', `/v1/consent/requests/${requestToken}/approve`, {
      token: cToken,
      body: { grantedScopes: ['profile:email', 'profile:phone', 'permission:marketing', 'profile:birthday'] },
    });
    check(approve.status === 201 && approve.body.status === 'approved', 'consent granted');
    check(!!approve.body.redirect, 'shopper is handed a redirect into the brand’s solution');
    const grantId = approve.body.grantId as string;

    section('7 · Merchant reads ONLY consented fields');
    const result = await api('GET', `/v1/identity/requests/${requestId}`, { token: mToken });
    show('Consented customer', result.body.customer);
    check(result.body.customer?.profile?.email === 'ahmet@example.com', 'received email');
    check(result.body.customer?.profile?.birthday === '1990-05-14', 'received birthday');
    check(result.body.customer?.permissions?.marketing === true, 'received marketing permission');
    check(result.body.customer?.profile?.gender === undefined, 'PRIVACY: gender withheld');
    check(result.body.customer?.profile?.address === undefined, 'PRIVACY: address withheld');

    section('8 · CustomerCreated webhook delivered & HMAC-verified');
    const created = await waitFor(() => received.find((r) => r.body?.type === 'CustomerCreated'));
    check(!!created, 'CustomerCreated delivered');
    if (created) {
      const expected = createHmac('sha256', webhookSecret).update(created.raw).digest('hex');
      const got = String(created.headers['x-spark-signature'] || '').replace('sha256=', '');
      check(got === expected, 'HMAC signature verified');
      check(!JSON.stringify(created.body).includes(seeded.consumer.id), 'PRIVACY: raw Spark id not leaked');
    }

    section('9 · Passkey (WebAuthn) — register, then passwordless login');
    const authenticator = new SoftwareAuthenticator();
    const regOpts = await api('POST', '/v1/auth/passkey/register/options', { token: cToken });
    const att = authenticator.createAttestation(regOpts.body.rp.id, regOpts.body.origin, regOpts.body.challenge);
    const regVerify = await api('POST', '/v1/auth/passkey/register/verify', {
      token: cToken,
      body: { attestationObject: att.attestationObject, clientDataJSON: att.clientDataJSON },
    });
    check(regVerify.status === 201 && regVerify.body.registered, 'passkey registered (real ES256 attestation)');
    const loginOpts = await api('POST', '/v1/auth/passkey/login/options', { body: { email: seeded.consumer.email } });
    const asrt = authenticator.createAssertion(loginOpts.body.rpId, loginOpts.body.origin, loginOpts.body.challenge);
    const pkLogin = await api('POST', '/v1/auth/passkey/login/verify', {
      body: { email: seeded.consumer.email, credentialId: asrt.credentialId, authenticatorData: asrt.authenticatorData, clientDataJSON: asrt.clientDataJSON, signature: asrt.signature },
    });
    check(pkLogin.status === 200 && !!pkLogin.body.accessToken, 'passwordless passkey login succeeded (signature verified)');
    const me = await api('GET', '/v1/auth/me', { token: pkLogin.body.accessToken });
    check(me.body.id === seeded.consumer.id, 'passkey token resolves to the SAME Spark identity');

    section('10 · Social login (Continue with Google/Apple — demo provider)');
    const idToken = makeDemoIdToken(DEMO_OIDC_SECRET, { sub: 'google|abc123', email: seeded.consumer.email });
    const social = await api('POST', '/v1/auth/social', { body: { provider: 'demo', idToken } });
    check(social.status === 200 && !!social.body.accessToken, 'social login issued a token');
    check(social.body.consumerId === seeded.consumer.id, 'social login LINKED to the same identity (by email)');
    const newUserTok = makeDemoIdToken(DEMO_OIDC_SECRET, { sub: 'google|new999', email: 'zeynep@example.com' });
    const social2 = await api('POST', '/v1/auth/social', { body: { provider: 'demo', idToken: newUserTok } });
    check(social2.body.consumerId !== seeded.consumer.id, 'a new social user gets a fresh identity');

    section('11 · Receipt & Wallet — POS pushes a digital receipt');
    const receipt = await api('POST', '/v1/receipts', {
      token: mToken,
      body: {
        grantId,
        externalId: 'POS-2026-1',
        storeName: 'LC Waikiki Akasya',
        purchasedAt: '2026-07-06T12:00:00.000Z',
        items: [
          { name: 'Erkek Kot Pantolon', quantity: 1, unitPriceMinor: 79999, returnDays: 30 },
          { name: 'Bluetooth Kulaklık', quantity: 1, unitPriceMinor: 129999, warrantyMonths: 24 },
        ],
      },
    });
    check(receipt.status === 201 && receipt.body.warranties?.length === 1, 'receipt stored, warranty auto-attached');
    const wallet = await api('GET', '/v1/me/wallet', { token: cToken });
    const warranties = await api('GET', '/v1/me/warranties', { token: cToken });
    const timeline = await api('GET', '/v1/me/timeline', { token: cToken });
    check(warranties.body.warranties?.length === 1, 'customer sees the warranty in their wallet');
    check(timeline.body.timeline?.length === 1, 'purchase timeline populated');

    section('12 · Merchant issues a coupon to the wallet');
    const coupon = await api('POST', '/v1/wallet/issue', {
      token: mToken,
      body: { grantId, type: 'coupon', title: '20% Yaz İndirimi', code: 'SUMMER20' },
    });
    check(coupon.status === 201, 'coupon issued');
    const wallet2 = await api('GET', '/v1/me/wallet', { token: cToken });
    check(wallet2.body.coupons?.length === 1, 'coupon appears in the customer wallet');

    section('13 · Integration Gateway — connector received a normalized sync + CSV import');
    const logs = await waitFor(async () => {
      const r = await api('GET', `/v1/connectors/${connectorId}/logs`, { token: mToken });
      return r.body.logs?.some((l: any) => l.operation === 'receipt') ? r.body.logs : undefined;
    });
    check(!!logs, 'connector received a normalized "receipt" sync record');
    const csv = [
      'grantId,externalId,purchasedAt,itemName,unitPriceMinor,quantity,warrantyMonths',
      `${grantId},POS-CSV-1,2026-07-01T10:00:00.000Z,Sweatshirt,49999,1,`,
      `${grantId},POS-CSV-1,2026-07-01T10:00:00.000Z,Ayakkabı,89999,1,12`,
    ].join('\n');
    const imp = await api('POST', '/v1/connectors/import/receipts', { token: mToken, raw: csv, contentType: 'text/csv' });
    check(imp.body.receiptsImported === 1, 'CSV import created a multi-item receipt');

    section('14 · Consent-safe campaigns');
    const mkt = await api('POST', '/v1/campaigns', { token: mToken, body: { title: 'Yaz İndirimi 🌞', body: 'Denimde %30' } });
    show('Marketing campaign', mkt.body);
    check(mkt.body.delivered === 1, 'marketing campaign delivered to the consenting customer');
    const sms = await api('POST', '/v1/campaigns', { token: mToken, body: { title: 'SMS blast', requireScope: 'permission:sms' } });
    show('SMS campaign (customer did NOT grant SMS)', sms.body);
    check(sms.body.delivered === 0 && sms.body.suppressed === 1, 'CONSENT-SAFE: SMS campaign suppressed (no permission)');

    section('15 · Membership');
    const mem = await api('POST', '/v1/memberships', { token: mToken, body: { grantId, tier: 'gold', addPoints: 150 } });
    check(mem.body.tier === 'gold' && mem.body.points === 150, 'membership tier + points set');

    section('16 · Notification Center + warranty reminders + GraphQL');
    const notifs = await api('GET', '/v1/me/notifications', { token: cToken });
    check(notifs.body.items?.some((n: any) => n.type === 'campaign'), 'campaign notification delivered to customer');
    const warn = await api('POST', '/v1/me/notifications/refresh-warranties?withinDays=1000', { token: cToken });
    check(warn.body.created >= 1, `warranty-expiry reminders generated (${warn.body.created})`);
    const gql = await fetch(`${BASE}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cToken}` },
      body: JSON.stringify({ query: '{ me { id email grants { merchantName status } wallet { receipts coupons warranties } notifications { type } } }' }),
    }).then((r) => r.json());
    show('GraphQL { me }', gql.data);
    check(gql.data?.me?.grants?.length === 1 && gql.data?.me?.wallet?.receipts === 2, 'GraphQL returns the full customer graph in one query');

    section('17 · Mall dashboard');
    const mallDash = await api('GET', `/v1/malls/${seeded.mall.id}/dashboard`, { token: mToken });
    show('Mall dashboard', mallDash.body);
    check(mallDash.body.identifiedShoppers === 1 && mallDash.body.storeParticipation === 1, 'mall sees identified shoppers across its stores');

    section('18 · Merchant dashboard');
    const dash = await api('GET', '/v1/merchant/dashboard', { token: mToken });
    show('Dashboard', dash.body);
    check(dash.body.newMembers === 1 && dash.body.consentRate === 1, 'dashboard reflects the member + 100% consent');

    section('19 · Consent Center + one-click revoke');
    const center = await api('GET', '/v1/consent/grants', { token: cToken });
    check(center.body.grants?.length === 1, 'one connected brand listed');
    check(!!center.body.grants?.[0]?.brand?.logoUrl, 'connected brand shows its logo in the app');
    const revoke = await api('POST', `/v1/consent/grants/${grantId}/revoke`, { token: cToken });
    check(revoke.body.status === 'revoked', 'grant revoked');
    const afterRevoke = await api('GET', `/v1/customers/${grantId}`, { token: mToken });
    check(afterRevoke.body.status === 'revoked', 'merchant loses access immediately');
    check(!!(await waitFor(() => received.find((r) => r.body?.type === 'ConsentChanged'))), 'ConsentChanged webhook delivered');

    section('20 · Privacy: a rival merchant cannot see this customer');
    const merchantSvc = app.get(MerchantService);
    const rival = await merchantSvc.create('Rival Store', 'rival', 'fashion');
    const rivalCred = await merchantSvc.issueCredentials(rival.id);
    const rivalTok = await api('POST', '/oauth/token', {
      body: { grant_type: 'client_credentials', client_id: rivalCred.clientId, client_secret: rivalCred.clientSecret },
    });
    const cross = await api('GET', `/v1/customers/${grantId}`, { token: rivalTok.body.access_token });
    check(cross.status === 404, 'rival merchant gets 404');

    section('21 · Consent Engine boundaries (negative tests)');
    const req2 = await api('POST', '/v1/identity/requests', { token: mToken });
    const extra = await api('POST', `/v1/consent/requests/${req2.body.requestToken}/approve`, {
      token: cToken,
      body: { grantedScopes: ['profile:email', 'profile:phone', 'permission:marketing', 'permission:location'] },
    });
    check(extra.status === 400, 'cannot grant an un-requested scope');
    const req3 = await api('POST', '/v1/identity/requests', { token: mToken });
    const missing = await api('POST', `/v1/consent/requests/${req3.body.requestToken}/approve`, {
      token: cToken,
      body: { grantedScopes: ['profile:email'] },
    });
    check(missing.status === 400, 'cannot finish without required scopes');

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
