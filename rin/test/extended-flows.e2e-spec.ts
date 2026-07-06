import 'reflect-metadata';

process.env.DB_DRIVER = 'sqlite';
process.env.DB_SQLITE_PATH = ':memory:';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as express from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ProblemDetailsFilter } from '../src/common/errors/problem.filter';
import { seed, SeedResult } from '../src/seed/seed-data';
import { SoftwareAuthenticator } from '../src/common/webauthn/authenticator';
import { makeDemoIdToken } from '../src/modules/identity/oidc-verifier';

describe('Spark RIN — extended platform flows (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let seeded: SeedResult;
  let mToken: string;
  let cToken: string;
  let grantId: string;

  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(express.text({ type: ['text/csv', 'text/plain'] }));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    http = request(app.getHttpServer());
    seeded = await seed(app);

    mToken = (
      await http.post('/oauth/token').send({
        grant_type: 'client_credentials',
        client_id: seeded.merchant.clientId,
        client_secret: seeded.merchant.clientSecret,
      })
    ).body.access_token;
    cToken = (
      await http.post('/v1/auth/login').send({ email: seeded.consumer.email, password: seeded.consumer.password })
    ).body.accessToken;

    const req = await http.post('/v1/identity/requests').set(bearer(mToken)).send({});
    await http
      .post(`/v1/consent/requests/${req.body.requestToken}/approve`)
      .set(bearer(cToken))
      .send({ grantedScopes: ['profile:email', 'profile:phone', 'permission:marketing'] });
    grantId = (await http.get('/v1/consent/grants').set(bearer(cToken))).body.grants[0].grantId;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('passkey: registers and logs in passwordlessly with a real ES256 assertion', async () => {
    const authn = new SoftwareAuthenticator();
    const regOpts = await http.post('/v1/auth/passkey/register/options').set(bearer(cToken)).expect(200);
    const att = authn.createAttestation(regOpts.body.rp.id, regOpts.body.origin, regOpts.body.challenge);
    await http
      .post('/v1/auth/passkey/register/verify')
      .set(bearer(cToken))
      .send({ attestationObject: att.attestationObject, clientDataJSON: att.clientDataJSON })
      .expect(201);

    const loginOpts = await http.post('/v1/auth/passkey/login/options').send({ email: seeded.consumer.email }).expect(200);
    const asrt = authn.createAssertion(loginOpts.body.rpId, loginOpts.body.origin, loginOpts.body.challenge);
    const res = await http
      .post('/v1/auth/passkey/login/verify')
      .send({
        email: seeded.consumer.email,
        credentialId: asrt.credentialId,
        authenticatorData: asrt.authenticatorData,
        clientDataJSON: asrt.clientDataJSON,
        signature: asrt.signature,
      })
      .expect(200);
    expect(res.body.consumerId).toBe(seeded.consumer.id);
  });

  it('passkey: a forged signature is rejected', async () => {
    const authn = new SoftwareAuthenticator();
    const regOpts = await http.post('/v1/auth/passkey/register/options').set(bearer(cToken)).expect(200);
    const att = authn.createAttestation(regOpts.body.rp.id, regOpts.body.origin, regOpts.body.challenge);
    await http
      .post('/v1/auth/passkey/register/verify')
      .set(bearer(cToken))
      .send({ attestationObject: att.attestationObject, clientDataJSON: att.clientDataJSON })
      .expect(201);
    const loginOpts = await http.post('/v1/auth/passkey/login/options').send({ email: seeded.consumer.email });
    const asrt = authn.createAssertion(loginOpts.body.rpId, loginOpts.body.origin, loginOpts.body.challenge);
    const tampered = Buffer.from(asrt.signature, 'base64url');
    tampered[tampered.length - 1] ^= 0xff;
    await http
      .post('/v1/auth/passkey/login/verify')
      .send({
        email: seeded.consumer.email,
        credentialId: asrt.credentialId,
        authenticatorData: asrt.authenticatorData,
        clientDataJSON: asrt.clientDataJSON,
        signature: tampered.toString('base64url'),
      })
      .expect(401);
  });

  it('social: links to the same identity by email', async () => {
    const idToken = makeDemoIdToken('demo-oidc-secret', { sub: 'google|x1', email: seeded.consumer.email });
    const res = await http.post('/v1/auth/social').send({ provider: 'demo', idToken }).expect(200);
    expect(res.body.consumerId).toBe(seeded.consumer.id);
  });

  it('receipt upload attaches a warranty the customer can see', async () => {
    await http
      .post('/v1/receipts')
      .set(bearer(mToken))
      .send({
        grantId,
        purchasedAt: '2026-07-06T12:00:00.000Z',
        items: [{ name: 'Kulaklık', quantity: 1, unitPriceMinor: 129999, warrantyMonths: 24 }],
      })
      .expect(201);
    const warranties = await http.get('/v1/me/warranties').set(bearer(cToken)).expect(200);
    expect(warranties.body.warranties).toHaveLength(1);
  });

  it('campaigns are consent-safe: marketing delivers, SMS is suppressed', async () => {
    const mkt = await http.post('/v1/campaigns').set(bearer(mToken)).send({ title: 'Sale' }).expect(201);
    expect(mkt.body.delivered).toBe(1);
    const sms = await http
      .post('/v1/campaigns')
      .set(bearer(mToken))
      .send({ title: 'SMS', requireScope: 'permission:sms' })
      .expect(201);
    expect(sms.body.delivered).toBe(0);
    expect(sms.body.suppressed).toBe(1);
  });

  it('GraphQL returns the customer graph in one query', async () => {
    const res = await http
      .post('/graphql')
      .set(bearer(cToken))
      .send({ query: '{ me { id email grants { status } wallet { receipts warranties } } }' })
      .expect(200);
    expect(res.body.data.me.grants).toHaveLength(1);
    expect(res.body.data.me.wallet.warranties).toBe(1);
  });

  it('GraphQL me requires a consumer token', async () => {
    const res = await http.post('/graphql').send({ query: '{ me { id } }' }).expect(200);
    expect(res.body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });
});
