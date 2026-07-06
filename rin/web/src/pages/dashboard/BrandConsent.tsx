import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Button, Card, Field, Input, PageTitle, Spinner, Badge } from '../../components/ui';

const SCOPES = [
  { key: 'profile:email', label: 'Email address' },
  { key: 'profile:phone', label: 'Phone number' },
  { key: 'profile:name', label: 'Full name' },
  { key: 'profile:birthday', label: 'Birthday' },
  { key: 'profile:gender', label: 'Gender' },
  { key: 'profile:address', label: 'Address' },
  { key: 'permission:marketing', label: 'Marketing' },
  { key: 'permission:sms', label: 'SMS' },
  { key: 'permission:location', label: 'Location' },
  { key: 'permission:analytics', label: 'Analytics' },
];

type Sel = { on: boolean; required: boolean };

export default function BrandConsent() {
  const [branding, setBranding] = useState({ displayName: '', logoUrl: '', primaryColor: '#4f46e5', postConsentRedirectUrl: '' });
  const [sel, setSel] = useState<Record<string, Sel>>({});
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState('');

  useEffect(() => {
    (async () => {
      const [me, cfg] = await Promise.all([
        api.m('GET', '/v1/merchant/me'),
        api.m('GET', '/v1/merchant/consent-config'),
      ]);
      setBranding({
        displayName: me.branding?.displayName ?? me.name ?? '',
        logoUrl: me.branding?.logoUrl ?? '',
        primaryColor: me.branding?.primaryColor ?? '#4f46e5',
        postConsentRedirectUrl: me.branding?.postConsentRedirectUrl ?? '',
      });
      const map: Record<string, Sel> = {};
      for (const s of SCOPES) map[s.key] = { on: false, required: false };
      for (const f of cfg.fields ?? []) map[f.scopeKey] = { on: true, required: f.required };
      setSel(map);
      setLoading(false);
    })().catch(() => setLoading(false));
  }, []);

  async function saveBranding() {
    await api.m('PUT', '/v1/merchant/branding', branding);
    flash('Branding saved');
  }
  async function saveConsent() {
    const fields = SCOPES.filter((s) => sel[s.key]?.on).map((s) => ({ scopeKey: s.key, required: !!sel[s.key].required }));
    await api.m('PUT', '/v1/merchant/consent-config', { fields });
    flash('Consent config saved');
  }
  function flash(m: string) { setSaved(m); setTimeout(() => setSaved(''), 2000); }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div>
      <PageTitle title="Brand & Consent" subtitle="Your branding on the consent screen + the fields you request." action={saved ? <Badge tone="green">{saved}</Badge> : undefined} />
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-4 font-semibold text-ink">Brand identity</h3>
          <div className="space-y-3">
            <Field label="Display name"><Input value={branding.displayName} onChange={(e) => setBranding({ ...branding, displayName: e.target.value })} /></Field>
            <Field label="Logo URL"><Input value={branding.logoUrl} onChange={(e) => setBranding({ ...branding, logoUrl: e.target.value })} placeholder="https://…" /></Field>
            <Field label="Primary color">
              <div className="flex items-center gap-2">
                <input type="color" value={branding.primaryColor} onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })} className="h-9 w-12 rounded border border-slate-300" />
                <Input value={branding.primaryColor} onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })} />
              </div>
            </Field>
            <Field label="Post-consent redirect (your app / loyalty)"><Input value={branding.postConsentRedirectUrl} onChange={(e) => setBranding({ ...branding, postConsentRedirectUrl: e.target.value })} placeholder="https://app.brand.com/welcome" /></Field>
          </div>
          <Button className="mt-4" onClick={saveBranding}>Save branding</Button>
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 font-semibold text-ink">Consent Engine — requested fields</h3>
          <div className="space-y-1">
            {SCOPES.map((s) => {
              const v = sel[s.key] ?? { on: false, required: false };
              return (
                <div key={s.key} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-slate-50">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={v.on} onChange={(e) => setSel({ ...sel, [s.key]: { ...v, on: e.target.checked } })} />
                    {s.label}
                  </label>
                  <label className={`flex items-center gap-1 text-xs ${v.on ? 'text-slate-500' : 'text-slate-300'}`}>
                    <input type="checkbox" disabled={!v.on} checked={v.required} onChange={(e) => setSel({ ...sel, [s.key]: { ...v, required: e.target.checked } })} />
                    required
                  </label>
                </div>
              );
            })}
          </div>
          <Button className="mt-4" onClick={saveConsent}>Save consent config</Button>
        </Card>
      </div>
    </div>
  );
}
