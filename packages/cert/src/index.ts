/**
 * @grid/cert — Sertifikasyon & Güven Hattı (doküman §5.6).
 * Submit → yayın arası zorunlu geçit:
 *   1. Statik analiz (yasak API, exfiltration sinyali, izin-manifest tutarlılığı)
 *   2. Policy/uyum review (yüksek riskli kategoriler → insan review)
 *   3. Signing & sürüm kilidi (geçen paket GRID anahtarıyla imzalanır)
 * Dinamik/sandbox tarama Faz 1'de bu hatta stage olarak eklenir.
 */
import { strFromU8 } from 'fflate';
import { declaredCapabilities, declaredPermissions, type MiniAppManifest } from '@grid/manifest';
import { readPackage, sha256, signBytes, verifyBytes } from '@grid/pack';

export type Severity = 'block' | 'warn' | 'info';

export interface Finding {
  severity: Severity;
  rule: string;
  message: string;
  file?: string;
}

export type StageStatus = 'passed' | 'failed' | 'needs_human_review';

export interface StageResult {
  stage: 'static_analysis' | 'policy_review' | 'signing';
  status: StageStatus;
  findings: Finding[];
}

export interface Certificate {
  app_id: string;
  version_code: number;
  package_hash: string;
  issued_at: string;
  expires_at: string;
  stages: Array<{ stage: string; status: StageStatus }>;
}

export interface SignedCertificate {
  certificate: Certificate;
  /** Sertifika JSON'unun GRID anahtarıyla ed25519 imzası (base64). */
  signature: string;
}

export interface CertificationResult {
  passed: boolean;
  /** Yüksek riskli kategori: insan review beklemede (finans/sağlık/çocuk). */
  requiresHumanReview: boolean;
  stages: StageResult[];
  certificate?: SignedCertificate;
}

export interface CertificationOptions {
  /** GRID signing anahtarı (PEM pkcs8). */
  gridPrivateKey: string;
  /** Yüksek riskli kategori için insan review tamamlandı işareti. */
  humanApproved?: boolean;
  /** Sertifika zaman damgaları için saat (test edilebilirlik). */
  now?: Date;
  /** Sertifika geçerlilik süresi (gün). */
  validityDays?: number;
}

/** İnsan review zorunlu kategoriler (doküman §5.6 madde 4). */
export const HIGH_RISK_CATEGORIES = ['finance', 'health', 'kids'] as const;

const CODE_EXTENSIONS = ['.js', '.mjs', '.html'];

interface StaticRule {
  rule: string;
  pattern: RegExp;
  severity: Severity;
  message: string;
}

/** Yasak / şüpheli API kalıpları. Kaba ama etkili ilk hat; AST analizi Faz 1. */
const STATIC_RULES: StaticRule[] = [
  {
    rule: 'no-eval',
    pattern: /\beval\s*\(/,
    severity: 'block',
    message: 'Dinamik kod çalıştırma (`eval`) yasaktır.',
  },
  {
    rule: 'no-function-constructor',
    pattern: /\bnew\s+Function\s*\(/,
    severity: 'block',
    message: 'Dinamik kod çalıştırma (`new Function`) yasaktır.',
  },
  {
    rule: 'no-document-cookie',
    pattern: /document\s*\.\s*cookie/,
    severity: 'block',
    message: 'Host çerezlerine erişim (`document.cookie`) yasaktır — sandbox ihlali.',
  },
  {
    rule: 'no-parent-window',
    pattern: /\b(window\s*\.\s*)?(parent|top)\s*\.\s*(location|document|window)/,
    severity: 'block',
    message: 'Host penceresine doğrudan erişim yasaktır; sadece GRID Bridge kullanılabilir.',
  },
  {
    rule: 'no-remote-script',
    pattern: /<script[^>]+src\s*=\s*["']https?:\/\//i,
    severity: 'block',
    message: 'Uzak script yüklemek yasaktır — tüm kod imzalı paketin içinde olmalıdır.',
  },
  {
    rule: 'no-insecure-url',
    pattern: /["']http:\/\/(?!localhost|127\.0\.0\.1)/,
    severity: 'warn',
    message: 'Şifresiz (http://) uç nokta kullanımı tespit edildi.',
  },
];

/** Kod kullanımı → gerektirdiği manifest beyanı eşleşmeleri. */
const USAGE_REQUIREMENTS: Array<{
  rule: string;
  pattern: RegExp;
  requirement: { kind: 'permission' | 'capability'; name: string };
  message: string;
}> = [
  {
    rule: 'permission/geolocation',
    pattern: /navigator\s*\.\s*geolocation/,
    requirement: { kind: 'permission', name: 'geolocation' },
    message: 'Kod `navigator.geolocation` kullanıyor ama manifest `geolocation` iznini beyan etmiyor.',
  },
  {
    rule: 'permission/payment',
    pattern: /grid\s*\.\s*core\s*\.\s*pay\b/,
    requirement: { kind: 'permission', name: 'payment' },
    message: 'Kod `grid.core.pay` kullanıyor ama manifest `payment` iznini beyan etmiyor.',
  },
  {
    rule: 'capability/kyc',
    pattern: /grid\s*\.\s*capabilities\s*\.\s*identity\s*\.\s*kyc/,
    requirement: { kind: 'capability', name: 'identity.kyc' },
    message: 'Kod `identity.kyc` capability kullanıyor ama manifest `x-grid.capabilities` beyan etmiyor.',
  },
  {
    rule: 'capability/proof-of-personhood',
    pattern: /grid\s*\.\s*capabilities\s*\.\s*identity\s*\.\s*proofOfPersonhood/,
    requirement: { kind: 'capability', name: 'identity.proof_of_personhood' },
    message:
      'Kod `identity.proofOfPersonhood` capability kullanıyor ama manifest `x-grid.capabilities` beyan etmiyor.',
  },
];

function isCodeFile(name: string): boolean {
  return CODE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/** 1. aşama: statik analiz. */
export function staticAnalysis(
  files: Record<string, Uint8Array>,
  manifest: MiniAppManifest
): StageResult {
  const findings: Finding[] = [];
  const permissions = new Set(declaredPermissions(manifest));
  const capabilities = new Set(declaredCapabilities(manifest));

  for (const [name, bytes] of Object.entries(files)) {
    if (!isCodeFile(name)) continue;
    const source = strFromU8(bytes);

    for (const r of STATIC_RULES) {
      if (r.pattern.test(source)) {
        findings.push({ severity: r.severity, rule: r.rule, message: r.message, file: name });
      }
    }

    for (const u of USAGE_REQUIREMENTS) {
      if (!u.pattern.test(source)) continue;
      const declared =
        u.requirement.kind === 'permission'
          ? permissions.has(u.requirement.name)
          : capabilities.has(u.requirement.name);
      if (!declared) {
        findings.push({ severity: 'block', rule: u.rule, message: u.message, file: name });
      }
    }
  }

  const status: StageStatus = findings.some((f) => f.severity === 'block') ? 'failed' : 'passed';
  return { stage: 'static_analysis', status, findings };
}

/** 2. aşama: policy/uyum review. */
export function policyReview(
  manifest: MiniAppManifest,
  opts: { humanApproved?: boolean } = {}
): StageResult {
  const findings: Finding[] = [];
  const category = manifest['x-grid']?.category;

  if (category && (HIGH_RISK_CATEGORIES as readonly string[]).includes(category)) {
    if (opts.humanApproved) {
      findings.push({
        severity: 'info',
        rule: 'policy/high-risk-approved',
        message: `Yüksek riskli kategori "${category}" için insan review tamamlandı.`,
      });
    } else {
      findings.push({
        severity: 'warn',
        rule: 'policy/high-risk-category',
        message: `"${category}" yüksek riskli kategoridir; yayın öncesi insan review zorunludur.`,
      });
      return { stage: 'policy_review', status: 'needs_human_review', findings };
    }
  }

  return { stage: 'policy_review', status: 'passed', findings };
}

/** Sertifika üretir ve GRID anahtarıyla imzalar. */
export function issueCertificate(
  manifest: MiniAppManifest,
  packageHash: string,
  stages: StageResult[],
  opts: CertificationOptions
): SignedCertificate {
  const now = opts.now ?? new Date();
  const validityDays = opts.validityDays ?? 365;
  const certificate: Certificate = {
    app_id: manifest.app_id,
    version_code: manifest.version.code,
    package_hash: packageHash,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000).toISOString(),
    stages: stages.map((s) => ({ stage: s.stage, status: s.status })),
  };
  const payload = new TextEncoder().encode(JSON.stringify(certificate));
  return { certificate, signature: signBytes(payload, opts.gridPrivateKey) };
}

/** Sertifika imzasını ve paket hash eşleşmesini doğrular (runtime bunu çağırır). */
export function verifyCertificate(
  signed: SignedCertificate,
  packageBytes: Uint8Array,
  gridPublicKey: string,
  now: Date = new Date()
): { valid: boolean; reason?: string } {
  const payload = new TextEncoder().encode(JSON.stringify(signed.certificate));
  if (!verifyBytes(payload, signed.signature, gridPublicKey)) {
    return { valid: false, reason: 'signature' };
  }
  if (signed.certificate.package_hash !== sha256(packageBytes)) {
    return { valid: false, reason: 'hash_mismatch' };
  }
  if (new Date(signed.certificate.expires_at).getTime() < now.getTime()) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true };
}

/**
 * Tüm hattı çalıştırır: statik analiz → policy → (geçtiyse) signing.
 * Herhangi bir aşama fail olursa sertifika üretilmez ve gerekçe bulgularda döner.
 */
export function runCertification(
  packageBytes: Uint8Array,
  opts: CertificationOptions
): CertificationResult {
  const { manifest, files } = readPackage(packageBytes);
  const stages: StageResult[] = [];

  const staticResult = staticAnalysis(files, manifest);
  stages.push(staticResult);
  if (staticResult.status === 'failed') {
    return { passed: false, requiresHumanReview: false, stages };
  }

  const policyResult = policyReview(manifest, { humanApproved: opts.humanApproved });
  stages.push(policyResult);
  if (policyResult.status === 'needs_human_review') {
    return { passed: false, requiresHumanReview: true, stages };
  }
  if (policyResult.status === 'failed') {
    return { passed: false, requiresHumanReview: false, stages };
  }

  const certificate = issueCertificate(manifest, sha256(packageBytes), stages, opts);
  stages.push({ stage: 'signing', status: 'passed', findings: [] });
  return { passed: true, requiresHumanReview: false, stages, certificate };
}
