/**
 * Uçtan uca akış (doküman §6): geliştirici submit eder → sertifikasyon →
 * host katalogdan beğenir → listing canlıya alınır → kullanıcı host içinde
 * MiniApp'i açar (imza + sertifika doğrulama, SSO, capability handshake) →
 * ödeme → analytics → kill-switch.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPackageFromDir, generateSigningKeyPair, signBytes, verifyBytes } from '@grid/pack';
import { createRegistryServer } from '@grid/registry';
import { createGrid, createLocalTransportPair } from '@grid/sdk';
import { IdentityBroker, MiniAppHost, MockSparkAdapter } from '@grid/runtime';
import type { SignedCertificate } from '@grid/cert';

const exampleDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'hello-miniapp');

describe('GRID uçtan uca: submit → cert → listing → launch → kill', () => {
  it('tam yolculuk çalışır', async () => {
    // --- Kurulum: GRID operatörü ve geliştirici anahtarları
    const gridKeys = generateSigningKeyPair();
    const devKeys = generateSigningKeyPair();
    const registry = createRegistryServer({
      gridPrivateKey: gridKeys.privateKey,
      gridPublicKey: gridKeys.publicKey,
    });

    // --- 6.1: Developer build + submit
    const pkg = buildPackageFromDir(exampleDir);
    expect(pkg.manifest.app_id).toBe('com.grid.hello');

    const submit = await registry.inject({
      method: 'POST',
      url: '/v1/miniapps/com.grid.hello/versions',
      payload: {
        package: Buffer.from(pkg.bytes).toString('base64'),
        signature: signBytes(pkg.bytes, devKeys.privateKey),
        developerPublicKey: devKeys.publicKey,
      },
    });
    expect(submit.statusCode).toBe(201);
    const submitBody = submit.json();
    expect(submitBody.version.cert_status).toBe('certified');
    const versionId = submitBody.version.id as string;
    const certificate = submitBody.certification.certificate as SignedCertificate;

    // --- 6.3: Host katalogda görür, ister, onaylar, canlıya alır
    await registry.inject({
      method: 'POST',
      url: '/v1/hosts',
      payload: { id: 'spark', name: 'Spark by KOBIL', tier: 1, type: 'super_app' },
    });
    const catalog = await registry.inject({ method: 'GET', url: '/v1/catalog' });
    expect(catalog.json().miniapps.map((m: { app_id: string }) => m.app_id)).toContain('com.grid.hello');

    const listingRes = await registry.inject({
      method: 'POST',
      url: '/v1/listings',
      payload: { appId: 'com.grid.hello', versionId, hostId: 'spark' },
    });
    const listingId = listingRes.json().listing.id as string;
    await registry.inject({ method: 'POST', url: `/v1/listings/${listingId}/approve` });
    await registry.inject({
      method: 'POST',
      url: `/v1/listings/${listingId}/live`,
      payload: { placement: ['featured', 'category:general'] },
    });

    // --- 6.2: Host runtime paketi registry'den çeker, imzaları doğrular, başlatır
    const download = await registry.inject({
      method: 'GET',
      url: `/v1/packages/${pkg.hash}`,
    });
    const downloadedBytes = new Uint8Array(download.rawPayload);
    const downloadedSig = download.headers['x-grid-signature'] as string;
    expect(verifyBytes(downloadedBytes, downloadedSig, devKeys.publicKey)).toBe(true);

    const gridPublicKey = (await registry.inject({ method: 'GET', url: '/v1/keys/grid' })).json()
      .publicKey as string;

    const isLive = async () => {
      const res = await registry.inject({ method: 'GET', url: `/v1/listings/${listingId}` });
      return res.json().listing.state === 'live';
    };

    const host = await MiniAppHost.launch({
      packageBytes: downloadedBytes,
      developerSignature: downloadedSig,
      developerPublicKey: devKeys.publicKey,
      certificate,
      gridPublicKey,
      adapter: new MockSparkAdapter(),
      broker: new IdentityBroker('federation-secret'),
      isLive,
    });

    const [sdkSide, hostSide] = createLocalTransportPair();
    host.attach(hostSide);
    const grid = await createGrid(sdkSide, { timeoutMs: 2000 });

    // SSO + capability handshake: Spark kyc sunar, proof-of-personhood sunmaz.
    expect(grid.hostId).toBe('spark');
    expect(grid.capabilities.identity.kyc).toBe(true);
    expect(grid.capabilities.identity.proofOfPersonhood).toBe(false);

    const user = await grid.core.auth.getUser();
    expect(user.sub).toMatch(/^[0-9a-f]{32}$/); // pairwise pseudonym, ham host id değil
    expect(user.claims.kyc_level).toBe('full');

    // Ödeme host rayından geçer.
    const payment = await grid.core.pay.request({ amount: 10, currency: 'TRY' });
    expect(payment.status).toBe('approved');

    // --- P0.6: analytics olayları
    await registry.inject({
      method: 'POST',
      url: '/v1/events',
      payload: { listingId, type: 'activation' },
    });
    await registry.inject({
      method: 'POST',
      url: '/v1/events',
      payload: { listingId, type: 'transaction' },
    });
    const devAnalytics = await registry.inject({
      method: 'GET',
      url: '/v1/analytics/apps/com.grid.hello',
    });
    expect(devAnalytics.json().by_host.spark).toMatchObject({ activations: 1, transactions: 1 });

    // --- P0.3: kill-switch — host pause basınca sonraki çağrı anında kesilir
    await registry.inject({ method: 'POST', url: `/v1/listings/${listingId}/kill` });
    await expect(grid.core.auth.getUser()).rejects.toMatchObject({ code: 'GRID_KILLED' });

    // Paused durumdaki listing yeniden launch da edilemez.
    await expect(
      MiniAppHost.launch({
        packageBytes: downloadedBytes,
        adapter: new MockSparkAdapter(),
        broker: new IdentityBroker('federation-secret'),
        isLive,
      })
    ).rejects.toThrow(/canlı değil/);
  });
});
