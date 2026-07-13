import 'reflect-metadata';

// In-memory SQLite so the suite runs with zero external dependencies.
process.env.DB_DRIVER = 'sqlite';
process.env.DB_SQLITE_PATH = ':memory:';
process.env.IDENTITY_REQUEST_TTL = '300';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ProblemDetailsFilter } from '../src/common/errors/problem.filter';
import { seed, SeedResult } from '../src/seed/seed-data';

describe('Spark RIN — Continue with Spark handshake (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let seeded: SeedResult;
  let mToken: string;
  let cToken: string;
  let requestToken: string;
  let requestId: string;
  let grantId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    http = request(app.getHttpServer());
    seeded = await seed(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('merchant exchanges client credentials for a token', async () => {
    const res = await http
      .post('/oauth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: seeded.merchant.clientId,
        client_secret: seeded.merchant.clientSecret,
      })
      .expect(200);
    expect(res.body.access_token).toBeDefined();
    mToken = res.body.access_token;
  });

  it('rejects bad client credentials', async () => {
    await http
      .post('/oauth/token')
      .send({ grant_type: 'client_credentials', client_id: seeded.merchant.clientId, client_secret: 'wrong' })
      .expect(401);
  });

  it('merchant creates an identity request', async () => {
    const res = await http
      .post('/v1/identity/requests')
      .set('authorization', `Bearer ${mToken}`)
      .send({ reference: 'POS-1' })
      .expect(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.requestToken).toBeDefined();
    expect(res.body.qr.deeplink).toContain('spark://join');
    requestToken = res.body.requestToken;
    requestId = res.body.requestId;
  });

  it('rejects unauthenticated request creation', async () => {
    await http.post('/v1/identity/requests').send({}).expect(401);
  });

  it('consumer logs in', async () => {
    const res = await http
      .post('/v1/auth/login')
      .send({ email: seeded.consumer.email, password: seeded.consumer.password })
      .expect(200);
    cToken = res.body.accessToken;
    expect(cToken).toBeDefined();
  });

  it('consumer views the pending request', async () => {
    const res = await http
      .get(`/v1/consent/requests/${requestToken}`)
      .set('authorization', `Bearer ${cToken}`)
      .expect(200);
    expect(res.body.merchant.name).toBe('LC Waikiki');
    expect(res.body.requested).toHaveLength(6);
  });

  it('consumer approves a granular subset', async () => {
    const res = await http
      .post(`/v1/consent/requests/${requestToken}/approve`)
      .set('authorization', `Bearer ${cToken}`)
      .send({ grantedScopes: ['profile:email', 'profile:phone', 'permission:marketing', 'profile:birthday'] })
      .expect(201);
    expect(res.body.status).toBe('approved');
    grantId = res.body.grantId;
  });

  it('merchant receives ONLY the consented fields', async () => {
    const res = await http
      .get(`/v1/identity/requests/${requestId}`)
      .set('authorization', `Bearer ${mToken}`)
      .expect(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.customer.profile.email).toBe('ahmet@example.com');
    expect(res.body.customer.profile.birthday).toBe('1990-05-14');
    expect(res.body.customer.permissions.marketing).toBe(true);
    // Declined scopes must never appear.
    expect(res.body.customer.profile.gender).toBeUndefined();
    expect(res.body.customer.profile.address).toBeUndefined();
  });

  it('rejects granting a scope the merchant did not request', async () => {
    const req = await http
      .post('/v1/identity/requests')
      .set('authorization', `Bearer ${mToken}`)
      .send({})
      .expect(201);
    await http
      .post(`/v1/consent/requests/${req.body.requestToken}/approve`)
      .set('authorization', `Bearer ${cToken}`)
      .send({ grantedScopes: ['profile:email', 'profile:phone', 'permission:marketing', 'permission:location'] })
      .expect(400);
  });

  it('rejects approval missing a required scope', async () => {
    const req = await http
      .post('/v1/identity/requests')
      .set('authorization', `Bearer ${mToken}`)
      .send({})
      .expect(201);
    await http
      .post(`/v1/consent/requests/${req.body.requestToken}/approve`)
      .set('authorization', `Bearer ${cToken}`)
      .send({ grantedScopes: ['profile:email'] })
      .expect(400);
  });

  it('dashboard reflects the new member', async () => {
    const res = await http
      .get('/v1/merchant/dashboard')
      .set('authorization', `Bearer ${mToken}`)
      .expect(200);
    expect(res.body.newMembers).toBe(1);
    expect(res.body.consentRate).toBe(1);
  });

  it('consumer revokes and the merchant loses access', async () => {
    await http
      .post(`/v1/consent/grants/${grantId}/revoke`)
      .set('authorization', `Bearer ${cToken}`)
      .expect(200);
    const res = await http
      .get(`/v1/customers/${grantId}`)
      .set('authorization', `Bearer ${mToken}`)
      .expect(200);
    expect(res.body.status).toBe('revoked');
    expect(res.body.customer).toBeUndefined();
  });

  it('a consumer token cannot call merchant endpoints', async () => {
    await http.get('/v1/merchant/dashboard').set('authorization', `Bearer ${cToken}`).expect(401);
  });
});
