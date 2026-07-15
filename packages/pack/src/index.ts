/**
 * @grid/pack — W3C MiniApp Packaging (https://www.w3.org/TR/miniapp-packaging/)
 * Tek zip konteyner (`application/miniapp-pkg+zip`): manifest.json + sayfalar +
 * JS + stil + medya. Sürümler immutable ve içerik-hash'lidir; dijital imza
 * zorunludur (güven hattının temeli, K5).
 */
import { createHash, generateKeyPairSync, sign as edSign, verify as edVerify } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate';
import {
  validateManifest,
  type LintIssue,
  type MiniAppManifest,
} from '@grid/manifest';

export const MINIAPP_MIME = 'application/miniapp-pkg+zip';
export const MANIFEST_FILENAME = 'manifest.json';

export type PackageFiles = Record<string, Uint8Array | string>;

export interface BuiltPackage {
  /** miniapp-pkg+zip baytları */
  bytes: Uint8Array;
  /** sha256 içerik hash'i (hex) — sürüm kimliği bu hash'e bağlanır. */
  hash: string;
  manifest: MiniAppManifest;
}

export class PackageError extends Error {
  constructor(
    message: string,
    public readonly issues: LintIssue[] = []
  ) {
    super(message);
    this.name = 'PackageError';
  }
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function toU8(v: Uint8Array | string): Uint8Array {
  return typeof v === 'string' ? strToU8(v) : v;
}

/**
 * Dosya haritasından miniapp paketi üretir. `manifest.json` zorunludur,
 * manifest linter'dan geçmeli ve her `pages` girdisi için paket içinde
 * `<page>.html` bulunmalıdır.
 */
export function buildPackage(files: PackageFiles): BuiltPackage {
  const manifestRaw = files[MANIFEST_FILENAME];
  if (manifestRaw === undefined) {
    throw new PackageError(`Paket kökünde ${MANIFEST_FILENAME} bulunmalıdır.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof manifestRaw === 'string' ? manifestRaw : strFromU8(manifestRaw));
  } catch {
    throw new PackageError('manifest.json geçerli JSON değil.');
  }

  const result = validateManifest(parsed);
  if (!result.valid || !result.manifest) {
    throw new PackageError('Manifest doğrulaması başarısız.', result.issues);
  }
  const manifest = result.manifest;

  const missingPages = manifest.pages.filter((p) => files[`${p}.html`] === undefined);
  if (missingPages.length > 0) {
    throw new PackageError(
      `Manifestte tanımlı sayfaların dosyaları pakette yok: ${missingPages
        .map((p) => `${p}.html`)
        .join(', ')}`
    );
  }

  // Deterministik zip: dosyalar isim sırasıyla, sabit mtime ile eklenir ki
  // aynı içerik her zaman aynı hash'i üretsin (immutable sürüm garantisi).
  const entries: Record<string, Uint8Array> = {};
  for (const name of Object.keys(files).sort()) {
    entries[name] = toU8(files[name]!);
  }
  const bytes = zipSync(entries, { mtime: new Date('2000-01-01T00:00:00Z'), level: 6 });
  return { bytes, hash: sha256(bytes), manifest };
}

/** Bir dizini (CLI `grid build`) pakete çevirir. Gizli dosyalar ve node_modules atlanır. */
export function buildPackageFromDir(dir: string): BuiltPackage {
  const files: PackageFiles = {};
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        files[relative(dir, full).split(sep).join('/')] = readFileSync(full);
      }
    }
  };
  walk(dir);
  return buildPackage(files);
}

export interface ReadPackage {
  manifest: MiniAppManifest;
  files: Record<string, Uint8Array>;
}

/** Paket baytlarını açar, manifesti doğrular. */
export function readPackage(bytes: Uint8Array): ReadPackage {
  const files = unzipSync(bytes);
  const manifestRaw = files[MANIFEST_FILENAME];
  if (!manifestRaw) {
    throw new PackageError(`Pakette ${MANIFEST_FILENAME} yok.`);
  }
  const result = validateManifest(JSON.parse(strFromU8(manifestRaw)));
  if (!result.valid || !result.manifest) {
    throw new PackageError('Paketteki manifest geçersiz.', result.issues);
  }
  return { manifest: result.manifest, files };
}

export interface KeyPair {
  /** PEM (spki) */
  publicKey: string;
  /** PEM (pkcs8) */
  privateKey: string;
}

/** Geliştirici / GRID imza anahtarı üretir (ed25519). */
export function generateSigningKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/** Paket baytlarını ed25519 ile imzalar; base64 detached imza döndürür. */
export function signBytes(bytes: Uint8Array, privateKeyPem: string): string {
  return edSign(null, bytes, privateKeyPem).toString('base64');
}

/** Detached imzayı doğrular. */
export function verifyBytes(bytes: Uint8Array, signatureB64: string, publicKeyPem: string): boolean {
  try {
    return edVerify(null, bytes, publicKeyPem, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}
