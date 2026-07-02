/**
 * @grid/cli — geliştirici akışının komut satırı (§6.1):
 *   grid init <app_id>   → W3C manifest iskeleti + örnek sayfa
 *   grid validate        → manifest linter
 *   grid keygen          → geliştirici imza anahtarı üret
 *   grid build           → miniapp-pkg+zip + hash (+ imza)
 *   grid submit          → registry'ye yükle, sertifikasyon sonucunu göster
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateManifest, type LintIssue } from '@grid/manifest';
import {
  buildPackageFromDir,
  generateSigningKeyPair,
  signBytes,
} from '@grid/pack';

export interface CliContext {
  cwd: string;
  log: (line: string) => void;
  error: (line: string) => void;
  fetchImpl?: typeof fetch;
}

export interface CliResult {
  exitCode: number;
}

const KEY_FILE = 'grid.dev.key';
const PUB_FILE = 'grid.dev.pub';

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function printIssues(issues: LintIssue[], ctx: CliContext): void {
  for (const issue of issues) {
    const line = `  ${issue.level === 'error' ? '✗' : '⚠'} [${issue.code}] ${issue.message}${
      issue.path ? ` (${issue.path})` : ''
    }`;
    (issue.level === 'error' ? ctx.error : ctx.log)(line);
  }
}

function cmdInit(appId: string | undefined, ctx: CliContext): number {
  if (!appId) {
    ctx.error('Kullanım: grid init <app_id>  (ör. grid init com.acme.todo)');
    return 1;
  }
  const manifestPath = join(ctx.cwd, 'manifest.json');
  if (existsSync(manifestPath)) {
    ctx.error('manifest.json zaten var; init iptal edildi.');
    return 1;
  }
  const manifest = {
    app_id: appId,
    name: appId.split('.').pop() ?? appId,
    version: { name: '0.1.0', code: 1 },
    pages: ['pages/home'],
    icons: [{ src: 'icons/app.svg', sizes: 'any', type: 'image/svg+xml' }],
    req_permissions: [],
    'x-grid': {
      targets: [],
      category: 'general',
      monetization: 'free',
      capabilities: { required: [], optional: [] },
    },
  };
  mkdirSync(join(ctx.cwd, 'pages'), { recursive: true });
  mkdirSync(join(ctx.cwd, 'icons'), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(
    join(ctx.cwd, 'pages', 'home.html'),
    `<!-- ${appId} ana sayfası -->\n<main>\n  <h1>Merhaba GRID</h1>\n  <script src="../app.js"></script>\n</main>\n`
  );
  writeFileSync(
    join(ctx.cwd, 'app.js'),
    `// GRID Bridge örneği (K4: core + escape hatch)\n// const user = await grid.core.auth.getUser();\n`
  );
  writeFileSync(
    join(ctx.cwd, 'icons', 'app.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16"/></svg>\n'
  );
  ctx.log(`✓ ${appId} iskeleti oluşturuldu (manifest.json, pages/home.html, app.js).`);
  ctx.log('Sonraki adım: grid validate && grid keygen && grid build');
  return 0;
}

function cmdValidate(ctx: CliContext): number {
  const manifestPath = join(ctx.cwd, 'manifest.json');
  if (!existsSync(manifestPath)) {
    ctx.error('manifest.json bulunamadı. Önce `grid init <app_id>` çalıştırın.');
    return 1;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    ctx.error('manifest.json geçerli JSON değil.');
    return 1;
  }
  const result = validateManifest(parsed);
  printIssues(result.issues, ctx);
  if (result.valid) {
    ctx.log(`✓ Manifest geçerli (${result.issues.length} uyarı).`);
    return 0;
  }
  ctx.error('✗ Manifest doğrulaması başarısız.');
  return 1;
}

function cmdKeygen(ctx: CliContext): number {
  const keyPath = join(ctx.cwd, KEY_FILE);
  if (existsSync(keyPath)) {
    ctx.error(`${KEY_FILE} zaten var; üzerine yazılmadı.`);
    return 1;
  }
  const pair = generateSigningKeyPair();
  writeFileSync(keyPath, pair.privateKey, { mode: 0o600 });
  writeFileSync(join(ctx.cwd, PUB_FILE), pair.publicKey);
  ctx.log(`✓ İmza anahtarı üretildi: ${KEY_FILE} (gizli tutun), ${PUB_FILE}`);
  return 0;
}

function cmdBuild(ctx: CliContext): number {
  let built;
  try {
    built = buildPackageFromDir(ctx.cwd);
  } catch (e) {
    ctx.error(`✗ Build başarısız: ${(e as Error).message}`);
    const issues = (e as { issues?: LintIssue[] }).issues;
    if (issues) printIssues(issues, ctx);
    return 1;
  }
  const outDir = join(ctx.cwd, 'dist');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${built.manifest.app_id}-${built.manifest.version.code}.miniapp.zip`);
  writeFileSync(outFile, built.bytes);
  ctx.log(`✓ Paket: ${outFile}`);
  ctx.log(`  sha256: ${built.hash}`);

  const keyPath = join(ctx.cwd, KEY_FILE);
  if (existsSync(keyPath)) {
    const signature = signBytes(built.bytes, readFileSync(keyPath, 'utf8'));
    writeFileSync(`${outFile}.sig`, signature);
    ctx.log(`  imza: ${outFile}.sig`);
  } else {
    ctx.log(`  ⚠ ${KEY_FILE} yok — paket imzasız. Submit için önce \`grid keygen\`.`);
  }
  return 0;
}

async function cmdSubmit(flags: Record<string, string>, ctx: CliContext): Promise<number> {
  const registry = flags.registry;
  if (!registry) {
    ctx.error('Kullanım: grid submit --registry <url>');
    return 1;
  }
  const manifestPath = join(ctx.cwd, 'manifest.json');
  const keyPath = join(ctx.cwd, KEY_FILE);
  const pubPath = join(ctx.cwd, PUB_FILE);
  if (!existsSync(manifestPath)) {
    ctx.error('manifest.json bulunamadı.');
    return 1;
  }
  if (!existsSync(keyPath) || !existsSync(pubPath)) {
    ctx.error(`İmza anahtarı yok (${KEY_FILE}/${PUB_FILE}). Önce \`grid keygen\`.`);
    return 1;
  }

  let built;
  try {
    built = buildPackageFromDir(ctx.cwd);
  } catch (e) {
    ctx.error(`✗ Build başarısız: ${(e as Error).message}`);
    return 1;
  }

  const doFetch = ctx.fetchImpl ?? fetch;
  const url = `${registry.replace(/\/$/, '')}/v1/miniapps/${built.manifest.app_id}/versions`;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        package: Buffer.from(built.bytes).toString('base64'),
        signature: signBytes(built.bytes, readFileSync(keyPath, 'utf8')),
        developerPublicKey: readFileSync(pubPath, 'utf8'),
        humanApproved: flags['human-approved'] === 'true',
      }),
    });
  } catch (e) {
    ctx.error(`✗ Registry'ye ulaşılamadı: ${(e as Error).message}`);
    return 1;
  }

  const body = (await res.json()) as {
    error?: string;
    version?: { id: string; cert_status: string };
    certification?: {
      passed: boolean;
      requires_human_review: boolean;
      stages: Array<{ stage: string; status: string; findings: Array<{ rule: string; message: string; severity: string }> }>;
    };
  };

  if (body.error) {
    ctx.error(`✗ Submit reddedildi: ${body.error}`);
    return 1;
  }

  for (const stage of body.certification?.stages ?? []) {
    ctx.log(`  ${stage.status === 'passed' ? '✓' : '✗'} ${stage.stage}: ${stage.status}`);
    for (const f of stage.findings) {
      ctx.log(`      [${f.severity}] ${f.rule}: ${f.message}`);
    }
  }

  if (body.certification?.passed) {
    ctx.log(`✓ Sertifikalı — katalogda görünür. (sürüm: ${body.version?.id})`);
    return 0;
  }
  if (body.certification?.requires_human_review) {
    ctx.log('⏳ Yüksek riskli kategori: insan review bekleniyor.');
    return 0;
  }
  ctx.error('✗ Sertifikasyon başarısız — yukarıdaki gerekçeleri düzeltin.');
  return 1;
}

const HELP = `GRID CLI — bir kez yaz, federasyondaki tüm host'lara dağıt.

Komutlar:
  grid init <app_id>              W3C MiniApp iskeleti oluştur
  grid validate                   manifest linter
  grid keygen                     geliştirici imza anahtarı üret
  grid build                      miniapp-pkg+zip üret (+imza)
  grid submit --registry <url>    paketi GRID Registry'ye gönder
`;

export async function runCli(argv: string[], ctx: CliContext): Promise<CliResult> {
  const [command, ...rest] = argv;
  const { positional, flags } = parseFlags(rest);

  switch (command) {
    case 'init':
      return { exitCode: cmdInit(positional[0], ctx) };
    case 'validate':
      return { exitCode: cmdValidate(ctx) };
    case 'keygen':
      return { exitCode: cmdKeygen(ctx) };
    case 'build':
      return { exitCode: cmdBuild(ctx) };
    case 'submit':
      return { exitCode: await cmdSubmit(flags, ctx) };
    case 'help':
    case undefined:
      ctx.log(HELP);
      return { exitCode: 0 };
    default:
      ctx.error(`Bilinmeyen komut: ${command}\n${HELP}`);
      return { exitCode: 1 };
  }
}
