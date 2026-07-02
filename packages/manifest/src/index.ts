/**
 * @grid/manifest — W3C MiniApp Manifest (https://www.w3.org/TR/miniapp-manifest/)
 * tipleri ve linter'ı. GRID'e özgü alanlar `x-grid` altında vendor-prefix ile
 * taşınır (K1: standardı benimse, icat etme).
 */

export interface MiniAppIcon {
  src: string;
  sizes?: string;
  type?: string;
}

export interface MiniAppVersionInfo {
  /** İnsan-okur sürüm adı, ör. "1.2.0" */
  name: string;
  /** Monoton artan tamsayı sürüm kodu */
  code: number;
}

export interface PlatformVersionInfo {
  min_code: number;
  release_type?: string;
  target_code?: number;
}

export interface ReqPermission {
  name: string;
  reason?: string;
}

export interface MiniAppWidget {
  name: string;
  path: string;
  min_code?: number;
}

export type MonetizationModel = 'free' | 'host_pay' | 'user_pay' | 'commission';

/** GRID vendor uzantıları — manifestte `x-grid` anahtarı altında. */
export interface GridExtensions {
  /** Hedef host id'leri (ör. "spark", "world", "istanbul-senin"). */
  targets?: string[];
  /** Katalog kategorisi (policy review bu alana bakar). */
  category?: string;
  monetization?: MonetizationModel;
  capabilities?: {
    /** Bu capability'ler olmadan MiniApp çalışmaz. */
    required?: string[];
    /** Varsa kullanılır, yoksa core fallback (K4). */
    optional?: string[];
  };
}

export interface MiniAppManifest {
  dir?: 'ltr' | 'rtl' | 'auto';
  lang?: string;
  app_id: string;
  name: string;
  short_name?: string;
  description?: string;
  icons?: MiniAppIcon[];
  version: MiniAppVersionInfo;
  platform_version?: PlatformVersionInfo;
  /** Sayfa rotaları; ilk eleman ana sayfadır. Paket içinde `<page>.html` bulunmalıdır. */
  pages: string[];
  window?: Record<string, unknown>;
  widgets?: MiniAppWidget[];
  req_permissions?: ReqPermission[];
  color_scheme?: string;
  'x-grid'?: GridExtensions;
}

/** Runtime'ın core'da tanıdığı izinler (manifest `req_permissions[].name`). */
export const KNOWN_PERMISSIONS = [
  'geolocation',
  'camera',
  'microphone',
  'notifications',
  'clipboard',
  'storage',
  'payment',
  'identity.basic',
] as const;

/** Host süper güçleri — capability abstraction katmanının sözlüğü (K4). */
export const KNOWN_CAPABILITIES = [
  'identity.basic',
  'identity.kyc',
  'identity.proof_of_personhood',
  'social.graph',
  'pay.native',
] as const;

export const MONETIZATION_MODELS: MonetizationModel[] = [
  'free',
  'host_pay',
  'user_pay',
  'commission',
];

export interface LintIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  /** Manifest içindeki alan yolu, ör. "pages[2]" */
  path?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: LintIssue[];
  /** valid=true ise tiplenmiş manifest. */
  manifest?: MiniAppManifest;
}

const APP_ID_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Manifesti doğrular ve linter bulgularını döndürür.
 * `error` seviyesindeki bulgular manifesti geçersiz kılar; `warning`lar kılmaz.
 */
export function validateManifest(input: unknown): ValidationResult {
  const issues: LintIssue[] = [];
  const err = (code: string, message: string, path?: string) =>
    issues.push({ level: 'error', code, message, path });
  const warn = (code: string, message: string, path?: string) =>
    issues.push({ level: 'warning', code, message, path });

  if (!isPlainObject(input)) {
    err('manifest/not-object', 'Manifest bir JSON nesnesi olmalıdır.');
    return { valid: false, issues };
  }
  const m = input;

  // app_id
  if (typeof m.app_id !== 'string' || m.app_id.length === 0) {
    err('app_id/required', '`app_id` zorunludur ve boş olamaz.', 'app_id');
  } else {
    if (!APP_ID_PATTERN.test(m.app_id)) {
      err(
        'app_id/format',
        '`app_id` küçük harf, rakam, nokta ve tire içerebilir; harf/rakamla başlayıp bitmelidir.',
        'app_id'
      );
    } else if (!m.app_id.includes('.')) {
      warn(
        'app_id/reverse-domain',
        '`app_id` için ters alan adı önerilir (ör. "com.acme.todo").',
        'app_id'
      );
    }
  }

  // name
  if (typeof m.name !== 'string' || m.name.trim().length === 0) {
    err('name/required', '`name` zorunludur ve boş olamaz.', 'name');
  }
  if (typeof m.short_name === 'string' && m.short_name.length > 12) {
    warn('short_name/length', '`short_name` 12 karakteri aşmamalıdır.', 'short_name');
  }

  // version
  if (!isPlainObject(m.version)) {
    err('version/required', '`version` nesnesi zorunludur ({ name, code }).', 'version');
  } else {
    if (typeof m.version.name !== 'string' || m.version.name.length === 0) {
      err('version.name/required', '`version.name` zorunludur.', 'version.name');
    }
    if (
      typeof m.version.code !== 'number' ||
      !Number.isInteger(m.version.code) ||
      m.version.code < 1
    ) {
      err('version.code/positive-int', '`version.code` pozitif bir tamsayı olmalıdır.', 'version.code');
    }
  }

  // pages
  if (!Array.isArray(m.pages) || m.pages.length === 0) {
    err('pages/required', '`pages` en az bir rota içeren bir dizi olmalıdır.', 'pages');
  } else {
    const seen = new Set<string>();
    m.pages.forEach((p, i) => {
      if (typeof p !== 'string' || p.length === 0) {
        err('pages/entry-string', 'Her sayfa rotası boş olmayan bir string olmalıdır.', `pages[${i}]`);
        return;
      }
      if (p.startsWith('/')) {
        err('pages/no-leading-slash', `Sayfa rotası "/" ile başlayamaz: "${p}".`, `pages[${i}]`);
      }
      if (seen.has(p)) {
        err('pages/duplicate', `Sayfa rotası tekrar ediyor: "${p}".`, `pages[${i}]`);
      }
      seen.add(p);
    });
  }

  // icons
  if (m.icons !== undefined) {
    if (!Array.isArray(m.icons)) {
      err('icons/array', '`icons` bir dizi olmalıdır.', 'icons');
    } else {
      m.icons.forEach((icon, i) => {
        if (!isPlainObject(icon) || typeof icon.src !== 'string' || icon.src.length === 0) {
          err('icons/src-required', 'Her ikon `src` alanı içermelidir.', `icons[${i}]`);
        }
      });
    }
  } else {
    warn('icons/missing', 'İkon tanımlanmamış; katalog kartı varsayılan ikonla gösterilir.', 'icons');
  }

  // widgets
  if (m.widgets !== undefined) {
    if (!Array.isArray(m.widgets)) {
      err('widgets/array', '`widgets` bir dizi olmalıdır.', 'widgets');
    } else {
      m.widgets.forEach((w, i) => {
        if (!isPlainObject(w) || typeof w.name !== 'string' || typeof w.path !== 'string') {
          err('widgets/shape', 'Her widget `name` ve `path` içermelidir.', `widgets[${i}]`);
        }
      });
    }
  }

  // req_permissions
  if (m.req_permissions !== undefined) {
    if (!Array.isArray(m.req_permissions)) {
      err('req_permissions/array', '`req_permissions` bir dizi olmalıdır.', 'req_permissions');
    } else {
      const seen = new Set<string>();
      m.req_permissions.forEach((p, i) => {
        if (!isPlainObject(p) || typeof p.name !== 'string') {
          err('req_permissions/shape', 'Her izin `{ name, reason? }` biçiminde olmalıdır.', `req_permissions[${i}]`);
          return;
        }
        if (!(KNOWN_PERMISSIONS as readonly string[]).includes(p.name)) {
          err(
            'req_permissions/unknown',
            `Bilinmeyen izin: "${p.name}". Geçerli izinler: ${KNOWN_PERMISSIONS.join(', ')}.`,
            `req_permissions[${i}].name`
          );
        }
        if (seen.has(p.name)) {
          err('req_permissions/duplicate', `İzin tekrar ediyor: "${p.name}".`, `req_permissions[${i}]`);
        }
        seen.add(p.name);
        if (typeof p.reason !== 'string' || p.reason.length === 0) {
          warn(
            'req_permissions/reason',
            `"${p.name}" izni için kullanıcıya gösterilecek bir \`reason\` ekleyin.`,
            `req_permissions[${i}].reason`
          );
        }
      });
    }
  }

  // x-grid
  const xg = m['x-grid'];
  if (xg !== undefined) {
    if (!isPlainObject(xg)) {
      err('x-grid/object', '`x-grid` bir nesne olmalıdır.', 'x-grid');
    } else {
      if (xg.targets !== undefined) {
        if (!Array.isArray(xg.targets) || xg.targets.some((t) => typeof t !== 'string' || t.length === 0)) {
          err('x-grid.targets/strings', '`x-grid.targets` boş olmayan string dizisi olmalıdır.', 'x-grid.targets');
        }
      }
      if (xg.monetization !== undefined && !MONETIZATION_MODELS.includes(xg.monetization as MonetizationModel)) {
        err(
          'x-grid.monetization/enum',
          `Geçersiz monetizasyon modeli: "${String(xg.monetization)}". Geçerli: ${MONETIZATION_MODELS.join(', ')}.`,
          'x-grid.monetization'
        );
      }
      if (xg.capabilities !== undefined) {
        if (!isPlainObject(xg.capabilities)) {
          err('x-grid.capabilities/object', '`x-grid.capabilities` bir nesne olmalıdır.', 'x-grid.capabilities');
        } else {
          for (const kind of ['required', 'optional'] as const) {
            const list = (xg.capabilities as Record<string, unknown>)[kind];
            if (list === undefined) continue;
            if (!Array.isArray(list)) {
              err('x-grid.capabilities/array', `\`x-grid.capabilities.${kind}\` bir dizi olmalıdır.`, `x-grid.capabilities.${kind}`);
              continue;
            }
            list.forEach((c, i) => {
              if (typeof c !== 'string' || !(KNOWN_CAPABILITIES as readonly string[]).includes(c)) {
                err(
                  'x-grid.capabilities/unknown',
                  `Bilinmeyen capability: "${String(c)}". Geçerli: ${KNOWN_CAPABILITIES.join(', ')}.`,
                  `x-grid.capabilities.${kind}[${i}]`
                );
              }
            });
          }
        }
      }
    }
  }

  const valid = issues.every((i) => i.level !== 'error');
  return valid
    ? { valid, issues, manifest: m as unknown as MiniAppManifest }
    : { valid, issues };
}

/** MiniApp'in manifestte beyan ettiği tüm capability'ler (required + optional). */
export function declaredCapabilities(manifest: MiniAppManifest): string[] {
  const caps = manifest['x-grid']?.capabilities;
  return [...new Set([...(caps?.required ?? []), ...(caps?.optional ?? [])])];
}

/** Manifestte beyan edilen izin adları. */
export function declaredPermissions(manifest: MiniAppManifest): string[] {
  return (manifest.req_permissions ?? []).map((p) => p.name);
}
