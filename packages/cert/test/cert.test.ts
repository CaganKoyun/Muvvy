import { describe, expect, it } from 'vitest';
import { buildPackage, generateSigningKeyPair, sha256 } from '@grid/pack';
import { runCertification, verifyCertificate } from '@grid/cert';

const gridKeys = generateSigningKeyPair();

function makePackage(overrides: {
  appJs?: string;
  manifest?: Record<string, unknown>;
}) {
  const manifest = {
    app_id: 'com.acme.todo',
    name: 'Acme Todo',
    version: { name: '1.0.0', code: 1 },
    pages: ['pages/home'],
    icons: [{ src: 'icons/app.png' }],
    ...overrides.manifest,
  };
  return buildPackage({
    'manifest.json': JSON.stringify(manifest),
    'pages/home.html': '<h1>Todo</h1><script src="../app.js"></script>',
    'app.js': overrides.appJs ?? 'console.log("temiz kod");',
    'icons/app.png': new Uint8Array([1]),
  });
}

describe('runCertification', () => {
  it('temiz paket sertifika alır', () => {
    const pkg = makePackage({});
    const r = runCertification(pkg.bytes, { gridPrivateKey: gridKeys.privateKey });
    expect(r.passed).toBe(true);
    expect(r.certificate).toBeDefined();
    expect(r.stages.map((s) => s.stage)).toEqual(['static_analysis', 'policy_review', 'signing']);
  });

  it('eval içeren paket reddedilir ve gerekçe döner (P0.3 kabul kriteri)', () => {
    const pkg = makePackage({ appJs: 'eval("alert(1)")' });
    const r = runCertification(pkg.bytes, { gridPrivateKey: gridKeys.privateKey });
    expect(r.passed).toBe(false);
    expect(r.certificate).toBeUndefined();
    const staticStage = r.stages.find((s) => s.stage === 'static_analysis')!;
    expect(staticStage.status).toBe('failed');
    expect(staticStage.findings.some((f) => f.rule === 'no-eval' && f.severity === 'block')).toBe(true);
  });

  it('document.cookie erişimi bloklanır', () => {
    const pkg = makePackage({ appJs: 'const c = document.cookie;' });
    const r = runCertification(pkg.bytes, { gridPrivateKey: gridKeys.privateKey });
    expect(r.passed).toBe(false);
  });

  it('uzak script etiketi bloklanır', () => {
    const manifest = {
      app_id: 'com.acme.todo',
      name: 'Acme Todo',
      version: { name: '1.0.0', code: 1 },
      pages: ['pages/home'],
      icons: [{ src: 'i.png' }],
    };
    const pkg = buildPackage({
      'manifest.json': JSON.stringify(manifest),
      'pages/home.html': '<script src="https://evil.example/x.js"></script>',
      'i.png': new Uint8Array([1]),
    });
    const r = runCertification(pkg.bytes, { gridPrivateKey: gridKeys.privateKey });
    expect(r.passed).toBe(false);
    expect(
      r.stages[0]!.findings.some((f) => f.rule === 'no-remote-script')
    ).toBe(true);
  });

  it('izin beyan edilmeden geolocation kullanımı bloklanır', () => {
    const pkg = makePackage({ appJs: 'navigator.geolocation.getCurrentPosition(() => {});' });
    const r = runCertification(pkg.bytes, { gridPrivateKey: gridKeys.privateKey });
    expect(r.passed).toBe(false);
    expect(r.stages[0]!.findings.some((f) => f.rule === 'permission/geolocation')).toBe(true);
  });

  it('izin beyan edilmişse geolocation kullanımı geçer', () => {
    const pkg = makePackage({
      appJs: 'navigator.geolocation.getCurrentPosition(() => {});',
      manifest: { req_permissions: [{ name: 'geolocation', reason: 'Yakındaki görevler' }] },
    });
    const r = runCertification(pkg.bytes, { gridPrivateKey: gridKeys.privateKey });
    expect(r.passed).toBe(true);
  });

  it('beyan edilmemiş kyc capability kullanımı bloklanır', () => {
    const pkg = makePackage({ appJs: 'if (grid.capabilities.identity.kyc) {}' });
    const r = runCertification(pkg.bytes, { gridPrivateKey: gridKeys.privateKey });
    expect(r.passed).toBe(false);
    expect(r.stages[0]!.findings.some((f) => f.rule === 'capability/kyc')).toBe(true);
  });

  it('finans kategorisi insan review bekler; onaylanınca geçer', () => {
    const pkg = makePackage({ manifest: { 'x-grid': { category: 'finance' } } });

    const pending = runCertification(pkg.bytes, { gridPrivateKey: gridKeys.privateKey });
    expect(pending.passed).toBe(false);
    expect(pending.requiresHumanReview).toBe(true);

    const approved = runCertification(pkg.bytes, {
      gridPrivateKey: gridKeys.privateKey,
      humanApproved: true,
    });
    expect(approved.passed).toBe(true);
  });
});

describe('verifyCertificate', () => {
  it('geçerli sertifika doğrulanır', () => {
    const pkg = makePackage({});
    const r = runCertification(pkg.bytes, { gridPrivateKey: gridKeys.privateKey });
    const v = verifyCertificate(r.certificate!, pkg.bytes, gridKeys.publicKey);
    expect(v.valid).toBe(true);
  });

  it('farklı paket baytlarıyla hash uyuşmazlığı yakalanır', () => {
    const pkg = makePackage({});
    const other = makePackage({ appJs: 'console.log("başka sürüm");' });
    expect(sha256(pkg.bytes)).not.toBe(sha256(other.bytes));
    const r = runCertification(pkg.bytes, { gridPrivateKey: gridKeys.privateKey });
    const v = verifyCertificate(r.certificate!, other.bytes, gridKeys.publicKey);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('hash_mismatch');
  });

  it('yanlış GRID anahtarıyla imza doğrulanmaz', () => {
    const pkg = makePackage({});
    const r = runCertification(pkg.bytes, { gridPrivateKey: gridKeys.privateKey });
    const rogue = generateSigningKeyPair();
    const v = verifyCertificate(r.certificate!, pkg.bytes, rogue.publicKey);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('signature');
  });

  it('süresi dolmuş sertifika reddedilir', () => {
    const pkg = makePackage({});
    const r = runCertification(pkg.bytes, {
      gridPrivateKey: gridKeys.privateKey,
      now: new Date('2020-01-01T00:00:00Z'),
      validityDays: 1,
    });
    const v = verifyCertificate(
      r.certificate!,
      pkg.bytes,
      gridKeys.publicKey,
      new Date('2021-01-01T00:00:00Z')
    );
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('expired');
  });
});
