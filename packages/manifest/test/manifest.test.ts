import { describe, expect, it } from 'vitest';
import { declaredCapabilities, validateManifest } from '@grid/manifest';

const base = {
  app_id: 'com.acme.todo',
  name: 'Acme Todo',
  version: { name: '1.0.0', code: 1 },
  pages: ['pages/home', 'pages/settings'],
  icons: [{ src: 'icons/app.png', sizes: '192x192' }],
};

describe('validateManifest', () => {
  it('geçerli bir manifesti kabul eder', () => {
    const r = validateManifest(base);
    expect(r.valid).toBe(true);
    expect(r.manifest?.app_id).toBe('com.acme.todo');
    expect(r.issues.filter((i) => i.level === 'error')).toHaveLength(0);
  });

  it('nesne olmayan girdiyi reddeder', () => {
    expect(validateManifest('hello').valid).toBe(false);
    expect(validateManifest(null).valid).toBe(false);
  });

  it('app_id eksikse hata verir', () => {
    const r = validateManifest({ ...base, app_id: undefined });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.code === 'app_id/required')).toBe(true);
  });

  it('geçersiz app_id formatını reddeder', () => {
    const r = validateManifest({ ...base, app_id: 'Bad App!' });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.code === 'app_id/format')).toBe(true);
  });

  it('noktasız app_id için reverse-domain uyarısı üretir ama geçerli sayar', () => {
    const r = validateManifest({ ...base, app_id: 'todoapp' });
    expect(r.valid).toBe(true);
    expect(r.issues.some((i) => i.code === 'app_id/reverse-domain')).toBe(true);
  });

  it('pages boşsa hata verir', () => {
    const r = validateManifest({ ...base, pages: [] });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.code === 'pages/required')).toBe(true);
  });

  it('tekrar eden sayfa rotasını reddeder', () => {
    const r = validateManifest({ ...base, pages: ['pages/home', 'pages/home'] });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.code === 'pages/duplicate')).toBe(true);
  });

  it('version.code pozitif tamsayı olmalıdır', () => {
    const r = validateManifest({ ...base, version: { name: '1.0.0', code: 0 } });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.code === 'version.code/positive-int')).toBe(true);
  });

  it('bilinmeyen izni reddeder', () => {
    const r = validateManifest({
      ...base,
      req_permissions: [{ name: 'root-access', reason: 'x' }],
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.code === 'req_permissions/unknown')).toBe(true);
  });

  it('izin için reason eksikse uyarır', () => {
    const r = validateManifest({ ...base, req_permissions: [{ name: 'geolocation' }] });
    expect(r.valid).toBe(true);
    expect(r.issues.some((i) => i.code === 'req_permissions/reason')).toBe(true);
  });

  it('bilinmeyen capability adını reddeder', () => {
    const r = validateManifest({
      ...base,
      'x-grid': { capabilities: { required: ['identity.telepathy'] } },
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.code === 'x-grid.capabilities/unknown')).toBe(true);
  });

  it('geçersiz monetizasyon modelini reddeder', () => {
    const r = validateManifest({ ...base, 'x-grid': { monetization: 'pyramid' } });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.code === 'x-grid.monetization/enum')).toBe(true);
  });

  it('declaredCapabilities required+optional birleşimini döndürür', () => {
    const r = validateManifest({
      ...base,
      'x-grid': {
        capabilities: { required: ['identity.kyc'], optional: ['pay.native', 'identity.kyc'] },
      },
    });
    expect(r.valid).toBe(true);
    expect(declaredCapabilities(r.manifest!)).toEqual(['identity.kyc', 'pay.native']);
  });
});
