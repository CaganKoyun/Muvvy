import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildPackage, generateSigningKeyPair, signBytes } from '@grid/pack';
import { createRegistryServer } from '@grid/registry';

const gridKeys = generateSigningKeyPair();
const devKeys = generateSigningKeyPair();

function makePackage(versionCode = 1, appJs = 'console.log("ok")') {
  return buildPackage({
    'manifest.json': JSON.stringify({
      app_id: 'com.acme.todo',
      name: 'Acme Todo',
      version: { name: `1.0.${versionCode - 1}`, code: versionCode },
      pages: ['pages/home'],
      icons: [{ src: 'i.png' }],
    }),
    'pages/home.html': '<h1>Todo</h1>',
    'app.js': appJs,
    'i.png': new Uint8Array([1]),
  });
}

function submitBody(pkg: { bytes: Uint8Array }) {
  return {
    package: Buffer.from(pkg.bytes).toString('base64'),
    signature: signBytes(pkg.bytes, devKeys.privateKey),
    developerPublicKey: devKeys.publicKey,
  };
}

describe('registry', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = createRegistryServer({
      gridPrivateKey: gridKeys.privateKey,
      gridPublicKey: gridKeys.publicKey,
    });
  });

  async function submit(pkg = makePackage()) {
    return app.inject({
      method: 'POST',
      url: '/v1/miniapps/com.acme.todo/versions',
      payload: submitBody(pkg),
    });
  }

  async function setupLiveListing() {
    const sub = await submit();
    const versionId = sub.json().version.id as string;
    await app.inject({
      method: 'POST',
      url: '/v1/hosts',
      payload: { id: 'spark', name: 'Spark', tier: 1, type: 'super_app' },
    });
    const listingRes = await app.inject({
      method: 'POST',
      url: '/v1/listings',
      payload: { appId: 'com.acme.todo', versionId, hostId: 'spark' },
    });
    const listingId = listingRes.json().listing.id as string;
    await app.inject({ method: 'POST', url: `/v1/listings/${listingId}/approve` });
    await app.inject({
      method: 'POST',
      url: `/v1/listings/${listingId}/live`,
      payload: { placement: ['featured'] },
    });
    return { versionId, listingId };
  }

  it('health çalışır ve GRID public key servis edilir', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).json().ok).toBe(true);
    const keys = await app.inject({ method: 'GET', url: '/v1/keys/grid' });
    expect(keys.json().publicKey).toContain('BEGIN PUBLIC KEY');
  });

  it('P0.1 kabul: geçerli paket submit edilince imzalı sürüm registry\'ye yazılır', async () => {
    const res = await submit();
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.version.cert_status).toBe('certified');
    expect(body.version.package_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.certification.certificate.signature).toBeDefined();

    const list = await app.inject({ method: 'GET', url: '/v1/miniapps/com.acme.todo/versions' });
    expect(list.json().versions).toHaveLength(1);
  });

  it('P0.3 kabul: zararlı API içeren paket otomatik reddedilir ve gerekçe döner', async () => {
    const res = await submit(makePackage(1, 'eval("x")'));
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.version.cert_status).toBe('rejected');
    const findings = body.certification.stages[0].findings;
    expect(findings.some((f: { rule: string }) => f.rule === 'no-eval')).toBe(true);
  });

  it('imza paketi doğrulamıyorsa 400 döner', async () => {
    const pkg = makePackage();
    const other = generateSigningKeyPair();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/miniapps/com.acme.todo/versions',
      payload: { ...submitBody(pkg), signature: signBytes(pkg.bytes, other.privateKey) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('aynı sürüm kodu ikinci kez submit edilemez (immutable sürümler)', async () => {
    await submit();
    const res = await submit(makePackage(1, 'console.log("değişik içerik")'));
    expect(res.statusCode).toBe(409);
  });

  it('katalog yalnızca sertifikalı son sürümü gösterir', async () => {
    await submit(makePackage(1));
    await submit(makePackage(2));
    await submit(makePackage(3, 'eval("kötü")')); // reddedilir

    const res = await app.inject({ method: 'GET', url: '/v1/catalog' });
    const apps = res.json().miniapps;
    expect(apps).toHaveLength(1);
    expect(apps[0].version.code).toBe(2);
  });

  it('6.3 akışı: listing requested → approved → live', async () => {
    const { listingId } = await setupLiveListing();
    const res = await app.inject({ method: 'GET', url: `/v1/listings/${listingId}` });
    expect(res.json().listing.state).toBe('live');
    expect(res.json().listing.placement).toEqual(['featured']);
  });

  it('sertifikasız sürüm listelenemez', async () => {
    const sub = await submit(makePackage(1, 'eval("x")'));
    const versionId = sub.json().version.id as string;
    await app.inject({
      method: 'POST',
      url: '/v1/hosts',
      payload: { id: 'spark', name: 'Spark', tier: 1, type: 'super_app' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/listings',
      payload: { appId: 'com.acme.todo', versionId, hostId: 'spark' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('kill-switch: live listing pause edilir, tekrar canlıya alınabilir', async () => {
    const { listingId } = await setupLiveListing();

    const killed = await app.inject({ method: 'POST', url: `/v1/listings/${listingId}/kill` });
    expect(killed.json().listing.state).toBe('paused');

    const revived = await app.inject({ method: 'POST', url: `/v1/listings/${listingId}/live` });
    expect(revived.json().listing.state).toBe('live');
  });

  it('geçersiz durum geçişi 409 döner', async () => {
    const sub = await submit();
    const versionId = sub.json().version.id as string;
    await app.inject({
      method: 'POST',
      url: '/v1/hosts',
      payload: { id: 'spark', name: 'Spark', tier: 1, type: 'super_app' },
    });
    const listingRes = await app.inject({
      method: 'POST',
      url: '/v1/listings',
      payload: { appId: 'com.acme.todo', versionId, hostId: 'spark' },
    });
    const listingId = listingRes.json().listing.id as string;
    // requested → live doğrudan geçilemez (önce approve).
    const res = await app.inject({ method: 'POST', url: `/v1/listings/${listingId}/live` });
    expect(res.statusCode).toBe(409);
  });

  it('paket hash ile indirilebilir ve imza başlığı taşır', async () => {
    const pkg = makePackage();
    await submit(pkg);
    const res = await app.inject({ method: 'GET', url: `/v1/packages/${pkg.hash}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/miniapp-pkg+zip');
    expect(res.headers['x-grid-signature']).toBeDefined();
    expect(res.rawPayload.length).toBe(pkg.bytes.length);
  });

  it('P0.6: analytics olayları iki taraflı sayılır', async () => {
    const { listingId } = await setupLiveListing();
    for (const type of ['activation', 'usage', 'usage', 'transaction'] as const) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/events',
        payload: { listingId, type },
      });
      expect(res.statusCode).toBe(201);
    }

    const dev = await app.inject({ method: 'GET', url: '/v1/analytics/apps/com.acme.todo' });
    expect(dev.json().total).toMatchObject({
      live_listings: 1,
      activations: 1,
      usage_events: 2,
      transactions: 1,
    });
    expect(dev.json().by_host.spark.activations).toBe(1);

    const host = await app.inject({ method: 'GET', url: '/v1/analytics/hosts/spark' });
    expect(host.json().by_app['com.acme.todo'].usage_events).toBe(2);
  });
});
