import { describe, expect, it } from 'vitest';
import { buildPackage, generateSigningKeyPair, signBytes } from '@grid/pack';
import { runCertification } from '@grid/cert';
import { createGrid, createLocalTransportPair, GridRpcError } from '@grid/sdk';
import { IdentityBroker, LaunchError, MiniAppHost, MockSparkAdapter } from '@grid/runtime';

const devKeys = generateSigningKeyPair();
const gridKeys = generateSigningKeyPair();
const broker = new IdentityBroker('federation-secret');

function makePackage(manifestOverrides: Record<string, unknown> = {}) {
  const manifest = {
    app_id: 'com.acme.todo',
    name: 'Acme Todo',
    version: { name: '1.0.0', code: 1 },
    pages: ['pages/home', 'pages/settings'],
    icons: [{ src: 'i.png' }],
    req_permissions: [{ name: 'payment', reason: 'Görev satın alma' }],
    'x-grid': {
      targets: ['spark'],
      capabilities: { required: [], optional: ['identity.kyc', 'pay.native'] },
    },
    ...manifestOverrides,
  };
  return buildPackage({
    'manifest.json': JSON.stringify(manifest),
    'pages/home.html': '<h1>Todo</h1>',
    'pages/settings.html': '<h1>Ayarlar</h1>',
    'i.png': new Uint8Array([1]),
  });
}

async function launchWithSdk(host: MiniAppHost) {
  const [sdkSide, hostSide] = createLocalTransportPair();
  host.attach(hostSide);
  return createGrid(sdkSide, { timeoutMs: 1000 });
}

describe('MiniAppHost.launch', () => {
  it('geçerli imza + sertifika ile başlatılır (P0.2 kabul kriteri)', async () => {
    const pkg = makePackage();
    const cert = runCertification(pkg.bytes, { gridPrivateKey: gridKeys.privateKey });
    expect(cert.passed).toBe(true);

    const host = await MiniAppHost.launch({
      packageBytes: pkg.bytes,
      developerSignature: signBytes(pkg.bytes, devKeys.privateKey),
      developerPublicKey: devKeys.publicKey,
      certificate: cert.certificate,
      gridPublicKey: gridKeys.publicKey,
      adapter: new MockSparkAdapter(),
      broker,
    });
    expect(host.manifest.app_id).toBe('com.acme.todo');
  });

  it('bozuk geliştirici imzasını reddeder', async () => {
    const pkg = makePackage();
    const rogue = generateSigningKeyPair();
    await expect(
      MiniAppHost.launch({
        packageBytes: pkg.bytes,
        developerSignature: signBytes(pkg.bytes, rogue.privateKey),
        developerPublicKey: devKeys.publicKey,
        adapter: new MockSparkAdapter(),
        broker,
      })
    ).rejects.toThrowError(LaunchError);
  });

  it('host zorunlu capability sağlamıyorsa başlatmaz (uygunluk sinyali, §7.5)', async () => {
    const pkg = makePackage({
      'x-grid': { capabilities: { required: ['identity.proof_of_personhood'] } },
    });
    await expect(
      MiniAppHost.launch({ packageBytes: pkg.bytes, adapter: new MockSparkAdapter(), broker })
    ).rejects.toThrow(/proof_of_personhood/);
  });

  it('listing canlı değilse başlatmaz', async () => {
    const pkg = makePackage();
    await expect(
      MiniAppHost.launch({
        packageBytes: pkg.bytes,
        adapter: new MockSparkAdapter(),
        broker,
        isLive: () => false,
      })
    ).rejects.toThrow(/canlı değil/);
  });
});

describe('SDK ↔ Runtime köprüsü', () => {
  it('handshake capability kesişimini döndürür (host ∩ manifest)', async () => {
    const pkg = makePackage();
    const host = await MiniAppHost.launch({
      packageBytes: pkg.bytes,
      adapter: new MockSparkAdapter(),
      broker,
    });
    const grid = await launchWithSdk(host);

    // Manifest identity.kyc + pay.native beyan etti; host identity.basic de sunuyor
    // ama beyan edilmediği için MiniApp'e açılmaz.
    expect(grid.capabilities.identity.kyc).toBe(true);
    expect(grid.capabilities.pay.native).toBe(true);
    expect(grid.capabilities.identity.basic).toBe(false);
    expect(grid.capabilities.identity.proofOfPersonhood).toBe(false);
    expect(grid.hostId).toBe('spark');
  });

  it('SSO: getUser pairwise pseudonym döndürür, ham host id sızmaz (§5.5)', async () => {
    const pkg = makePackage();
    const host = await MiniAppHost.launch({
      packageBytes: pkg.bytes,
      adapter: new MockSparkAdapter(),
      broker,
    });
    const grid = await launchWithSdk(host);
    const user = await grid.core.auth.getUser();

    expect(user.sub).toMatch(/^[0-9a-f]{32}$/);
    expect(user.sub).not.toContain('kobil-user-42');
    // kyc claim'i geçer çünkü identity.kyc etkin.
    expect(user.claims.kyc_level).toBe('full');
  });

  it('aynı kullanıcı farklı app\'te farklı pairwise id alır', () => {
    const a = broker.pairwiseId('spark', 'com.acme.todo', 'kobil-user-42');
    const b = broker.pairwiseId('spark', 'com.other.app', 'kobil-user-42');
    expect(a).not.toBe(b);
  });

  it('identity.kyc etkin değilse kyc claim\'leri minimize edilir', async () => {
    const pkg = makePackage({
      'x-grid': { capabilities: { optional: ['pay.native'] } },
    });
    const host = await MiniAppHost.launch({
      packageBytes: pkg.bytes,
      adapter: new MockSparkAdapter(),
      broker,
    });
    const grid = await launchWithSdk(host);
    const user = await grid.core.auth.getUser();
    expect(user.claims.kyc_level).toBeUndefined();
    expect(grid.capabilities.identity.kyc).toBe(false);
  });

  it('storage get/set/remove çalışır', async () => {
    const pkg = makePackage();
    const host = await MiniAppHost.launch({
      packageBytes: pkg.bytes,
      adapter: new MockSparkAdapter(),
      broker,
    });
    const grid = await launchWithSdk(host);

    expect(await grid.core.storage.get('theme')).toBeNull();
    await grid.core.storage.set('theme', 'mono');
    expect(await grid.core.storage.get('theme')).toBe('mono');
    await grid.core.storage.remove('theme');
    expect(await grid.core.storage.get('theme')).toBeNull();
  });

  it('routing yalnızca manifestteki sayfalara izin verir', async () => {
    const pkg = makePackage();
    const host = await MiniAppHost.launch({
      packageBytes: pkg.bytes,
      adapter: new MockSparkAdapter(),
      broker,
    });
    const grid = await launchWithSdk(host);

    expect(await grid.core.routing.currentPage()).toBe('pages/home');
    await grid.core.routing.navigate('pages/settings');
    expect(await grid.core.routing.currentPage()).toBe('pages/settings');
    await expect(grid.core.routing.navigate('pages/hacked')).rejects.toThrowError(GridRpcError);
  });

  it('payment izniyle ödeme host rayından geçer', async () => {
    const pkg = makePackage();
    const host = await MiniAppHost.launch({
      packageBytes: pkg.bytes,
      adapter: new MockSparkAdapter(),
      broker,
    });
    const grid = await launchWithSdk(host);
    const result = await grid.core.pay.request({ amount: 49.9, currency: 'TRY' });
    expect(result.status).toBe('approved');
    expect(result.transactionId).toMatch(/^spark-tx-/);
  });

  it('payment izni beyan edilmemişse ödeme PERMISSION_DENIED döner', async () => {
    const pkg = makePackage({ req_permissions: [] });
    const host = await MiniAppHost.launch({
      packageBytes: pkg.bytes,
      adapter: new MockSparkAdapter(),
      broker,
    });
    const grid = await launchWithSdk(host);
    await expect(grid.core.pay.request({ amount: 10, currency: 'TRY' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('host.raw escape hatch adapter\'a ulaşır', async () => {
    const pkg = makePackage();
    const host = await MiniAppHost.launch({
      packageBytes: pkg.bytes,
      adapter: new MockSparkAdapter(),
      broker,
    });
    const grid = await launchWithSdk(host);
    expect(await grid.host.raw('spark.echo', { ping: 1 })).toEqual({ ping: 1 });
  });

  it('kill-switch: kill sonrası tüm çağrılar GRID_KILLED döner (P0.3)', async () => {
    const pkg = makePackage();
    const host = await MiniAppHost.launch({
      packageBytes: pkg.bytes,
      adapter: new MockSparkAdapter(),
      broker,
    });
    const grid = await launchWithSdk(host);

    expect((await grid.core.auth.getUser()).sub).toBeDefined();
    host.kill();
    await expect(grid.core.auth.getUser()).rejects.toMatchObject({ code: 'GRID_KILLED' });
  });

  it('kill-switch: isLive false olunca sonraki RPC anında kesilir', async () => {
    const pkg = makePackage();
    let live = true;
    const host = await MiniAppHost.launch({
      packageBytes: pkg.bytes,
      adapter: new MockSparkAdapter(),
      broker,
      isLive: () => live,
    });
    const grid = await launchWithSdk(host);

    await grid.core.storage.set('k', 1);
    live = false;
    await expect(grid.core.storage.get('k')).rejects.toMatchObject({ code: 'GRID_KILLED' });
  });
});
