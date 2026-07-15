import { describe, expect, it } from 'vitest';
import { strFromU8 } from 'fflate';
import {
  buildPackage,
  generateSigningKeyPair,
  PackageError,
  readPackage,
  signBytes,
  verifyBytes,
} from '@grid/pack';

const manifest = {
  app_id: 'com.acme.todo',
  name: 'Acme Todo',
  version: { name: '1.0.0', code: 1 },
  pages: ['pages/home'],
  icons: [{ src: 'icons/app.png' }],
};

const files = {
  'manifest.json': JSON.stringify(manifest),
  'pages/home.html': '<h1>Merhaba</h1>',
  'app.js': 'console.log("hi")',
  'icons/app.png': new Uint8Array([137, 80, 78, 71]),
};

describe('buildPackage', () => {
  it('paket üretir ve manifest ile hash döndürür', () => {
    const pkg = buildPackage(files);
    expect(pkg.manifest.app_id).toBe('com.acme.todo');
    expect(pkg.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(pkg.bytes.length).toBeGreaterThan(0);
  });

  it('deterministiktir: aynı içerik aynı hash', () => {
    const a = buildPackage(files);
    const b = buildPackage({ ...files });
    expect(a.hash).toBe(b.hash);
  });

  it('içerik değişince hash değişir', () => {
    const a = buildPackage(files);
    const b = buildPackage({ ...files, 'app.js': 'console.log("v2")' });
    expect(a.hash).not.toBe(b.hash);
  });

  it('manifest.json yoksa hata fırlatır', () => {
    expect(() => buildPackage({ 'app.js': 'x' })).toThrow(PackageError);
  });

  it('geçersiz manifesti reddeder ve linter bulgularını taşır', () => {
    try {
      buildPackage({ 'manifest.json': JSON.stringify({ name: 'x' }) });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PackageError);
      expect((e as PackageError).issues.length).toBeGreaterThan(0);
    }
  });

  it('manifestteki sayfanın dosyası pakette yoksa reddeder', () => {
    const bad = { ...files } as Record<string, string | Uint8Array>;
    delete bad['pages/home.html'];
    expect(() => buildPackage(bad)).toThrow(/pages\/home\.html/);
  });
});

describe('readPackage', () => {
  it('paketi açar ve dosyaları geri verir', () => {
    const pkg = buildPackage(files);
    const read = readPackage(pkg.bytes);
    expect(read.manifest.app_id).toBe('com.acme.todo');
    expect(strFromU8(read.files['pages/home.html']!)).toBe('<h1>Merhaba</h1>');
  });
});

describe('signing', () => {
  it('imzalar ve doğrular', () => {
    const { publicKey, privateKey } = generateSigningKeyPair();
    const pkg = buildPackage(files);
    const sig = signBytes(pkg.bytes, privateKey);
    expect(verifyBytes(pkg.bytes, sig, publicKey)).toBe(true);
  });

  it('bozulmuş paket imza doğrulamasından geçmez (tampering koruması)', () => {
    const { publicKey, privateKey } = generateSigningKeyPair();
    const pkg = buildPackage(files);
    const sig = signBytes(pkg.bytes, privateKey);
    const tampered = new Uint8Array(pkg.bytes);
    const i = tampered.length - 10;
    tampered[i] = (tampered[i] ?? 0) ^ 0xff;
    expect(verifyBytes(tampered, sig, publicKey)).toBe(false);
  });

  it('yanlış anahtarla doğrulama başarısız olur', () => {
    const dev = generateSigningKeyPair();
    const other = generateSigningKeyPair();
    const pkg = buildPackage(files);
    const sig = signBytes(pkg.bytes, dev.privateKey);
    expect(verifyBytes(pkg.bytes, sig, other.publicKey)).toBe(false);
  });
});
