import { useEffect, useState } from 'react';
import { db } from '../../db';
import { Button, Card, Field, Input, PageTitle, Spinner, Badge } from '../../components/ui';

type Sel = { on: boolean; required: boolean };

export default function BrandConsent() {
  const [branding, setBranding] = useState({ display_name: '', logo_url: '', primary_color: '#4f46e5', post_consent_redirect_url: '' });
  const [scopes, setScopes] = useState<any[]>([]);
  const [sel, setSel] = useState<Record<string, Sel>>({});
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState('');

  useEffect(() => {
    (async () => {
      const [me, sc, cfg] = await Promise.all([db.myMerchant(), db.scopes(), db.consentConfig()]);
      setBranding({
        display_name: me?.display_name ?? me?.name ?? '',
        logo_url: me?.logo_url ?? '',
        primary_color: me?.primary_color ?? '#4f46e5',
        post_consent_redirect_url: me?.post_consent_redirect_url ?? '',
      });
      setScopes(sc);
      const map: Record<string, Sel> = {};
      for (const s of sc) map[s.key] = { on: false, required: false };
      for (const f of cfg) map[f.scope_key] = { on: true, required: f.required };
      setSel(map);
      setLoading(false);
    })().catch(() => setLoading(false));
  }, []);

  function flash(m: string) { setSaved(m); setTimeout(() => setSaved(''), 2000); }
  async function saveBranding() { await db.updateBranding(branding); flash('Branding saved'); }
  async function saveConsent() {
    const fields = scopes.filter((s) => sel[s.key]?.on).map((s) => ({ scope_key: s.key, required: !!sel[s.key].required }));
    await db.setConsentConfig(fields); flash('Consent config saved');
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div>
      <PageTitle title="Brand & Consent" subtitle="Your branding on the consent screen + the fields you request." action={saved ? <Badge tone="green">{saved}</Badge> : undefined} />
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-4 font-semibold text-ink">Brand identity</h3>
          <div className="space-y-3">
            <Field label="Display name"><Input value={branding.display_name} onChange={(e) => setBranding({ ...branding, display_name: e.target.value })} /></Field>
            <Field label="Logo URL"><Input value={branding.logo_url} onChange={(e) => setBranding({ ...branding, logo_url: e.target.value })} placeholder="https://…" /></Field>
            <Field label="Primary color">
              <div className="flex items-center gap-2">
                <input type="color" value={branding.primary_color} onChange={(e) => setBranding({ ...branding, primary_color: e.target.value })} className="h-9 w-12 rounded border border-slate-300" />
                <Input value={branding.primary_color} onChange={(e) => setBranding({ ...branding, primary_color: e.target.value })} />
              </div>
            </Field>
            <Field label="Post-consent redirect (your app / loyalty)"><Input value={branding.post_consent_redirect_url} onChange={(e) => setBranding({ ...branding, post_consent_redirect_url: e.target.value })} placeholder="https://app.brand.com/welcome" /></Field>
          </div>
          <Button className="mt-4" onClick={saveBranding}>Save branding</Button>
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 font-semibold text-ink">Consent Engine — requested fields</h3>
          <div className="space-y-1">
            {scopes.map((s) => {
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
