import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateSigningKeyPair } from '@grid/pack';
import { createRegistryServer } from '@grid/registry';
import { runCli, type CliContext } from '@grid/cli';

function makeCtx(cwd: string): CliContext & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { cwd, out, err, log: (l) => out.push(l), error: (l) => err.push(l) };
}

describe('grid cli', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'grid-cli-'));
  });

  it('init → validate → keygen → build akışı çalışır', async () => {
    const ctx = makeCtx(dir);

    expect((await runCli(['init', 'com.acme.todo'], ctx)).exitCode).toBe(0);
    expect(existsSync(join(dir, 'manifest.json'))).toBe(true);
    expect(existsSync(join(dir, 'pages/home.html'))).toBe(true);

    expect((await runCli(['validate'], ctx)).exitCode).toBe(0);
    expect((await runCli(['keygen'], ctx)).exitCode).toBe(0);
    expect((await runCli(['build'], ctx)).exitCode).toBe(0);

    const zipPath = join(dir, 'dist', 'com.acme.todo-1.miniapp.zip');
    expect(existsSync(zipPath)).toBe(true);
    expect(existsSync(`${zipPath}.sig`)).toBe(true);
    expect(readFileSync(zipPath).length).toBeGreaterThan(0);
  });

  it('init app_id olmadan hata verir', async () => {
    const ctx = makeCtx(dir);
    expect((await runCli(['init'], ctx)).exitCode).toBe(1);
  });

  it('validate bozuk manifest için hata döner ve bulguları listeler', async () => {
    const ctx = makeCtx(dir);
    await runCli(['init', 'com.acme.todo'], ctx);
    const manifestPath = join(dir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.pages = [];
    const { writeFileSync } = await import('node:fs');
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const r = await runCli(['validate'], ctx);
    expect(r.exitCode).toBe(1);
    expect(ctx.err.some((l) => l.includes('pages/required'))).toBe(true);
  });

  it('bilinmeyen komut yardım metniyle hata döner', async () => {
    const ctx = makeCtx(dir);
    expect((await runCli(['frobnicate'], ctx)).exitCode).toBe(1);
    expect(ctx.err.join('\n')).toContain('Komutlar:');
  });
});

describe('grid submit (canlı registry ile)', () => {
  const gridKeys = generateSigningKeyPair();
  let app: FastifyInstance;
  let baseUrl: string;

  afterAll(async () => {
    await app?.close();
  });

  it('submit sertifikasyon sonucunu raporlar', async () => {
    app = createRegistryServer({
      gridPrivateKey: gridKeys.privateKey,
      gridPublicKey: gridKeys.publicKey,
    });
    baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });

    const dir = mkdtempSync(join(tmpdir(), 'grid-submit-'));
    const ctx = makeCtx(dir);
    await runCli(['init', 'com.acme.submitter'], ctx);
    await runCli(['keygen'], ctx);

    const r = await runCli(['submit', '--registry', baseUrl], ctx);
    expect(r.exitCode).toBe(0);
    expect(ctx.out.some((l) => l.includes('Sertifikalı'))).toBe(true);

    // Registry gerçekten yazdı mı?
    const versions = await app.inject({
      method: 'GET',
      url: '/v1/miniapps/com.acme.submitter/versions',
    });
    expect(versions.json().versions).toHaveLength(1);
    expect(versions.json().versions[0].cert_status).toBe('certified');
  });

  it('anahtar yoksa submit reddedilir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grid-submit-nokey-'));
    const ctx = makeCtx(dir);
    await runCli(['init', 'com.acme.nokey'], ctx);
    const r = await runCli(['submit', '--registry', baseUrl], ctx);
    expect(r.exitCode).toBe(1);
    expect(ctx.err.some((l) => l.includes('keygen'))).toBe(true);
  });
});
