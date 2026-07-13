import { useEffect, useState } from 'react';
import { db } from '../../db';
import { Badge, Button, Card, Field, Input, Spinner, SparkMark } from '../../components/ui';

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between py-2">
      <span className="text-sm text-slate-700">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
    </label>
  );
}

export default function Profile() {
  const [p, setP] = useState<any>({ first_name: '', last_name: '', phone: '', birthday: '', gender: '', pref_marketing_email: true, pref_sms: true, pref_push: true });
  const [memberships, setMemberships] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState('');

  async function load() {
    const [prof, mem, tr] = await Promise.all([db.profile(), db.myMemberships(), db.transparency()]);
    if (prof) setP({
      first_name: prof.first_name ?? '', last_name: prof.last_name ?? '', phone: prof.phone ?? '',
      birthday: prof.birthday ?? '', gender: prof.gender ?? '',
      pref_marketing_email: prof.pref_marketing_email ?? true, pref_sms: prof.pref_sms ?? true, pref_push: prof.pref_push ?? true,
    });
    setMemberships(mem ?? []); setAudit(tr ?? []); setLoading(false);
  }
  useEffect(() => { load().catch(() => setLoading(false)); }, []);

  function flash(m: string) { setSaved(m); setTimeout(() => setSaved(''), 2000); }
  async function save() {
    await db.saveProfile({
      first_name: p.first_name || null, last_name: p.last_name || null, phone: p.phone || null,
      birthday: p.birthday || null, gender: p.gender || null,
      pref_marketing_email: p.pref_marketing_email, pref_sms: p.pref_sms, pref_push: p.pref_push,
    });
    flash('Saved');
  }
  async function exportData() {
    const data = await db.exportMyData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'spark-my-data.json'; a.click();
  }
  async function revokeAll() { if (confirm('Withdraw consent from every brand?')) { await db.revokeAll(); flash('All consents revoked'); } }
  async function erase() { if (confirm('Erase your personal data? This revokes all brands and clears your profile.')) { await db.eraseMyData(); await load(); flash('Data erased'); } }

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-lg font-semibold text-ink">Profile & privacy</h1>
        <p className="text-sm text-slate-500">You own this data. Brands only ever see what you consent to.</p>
      </div>

      <Card className="p-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name"><Input value={p.first_name} onChange={(e) => setP({ ...p, first_name: e.target.value })} /></Field>
          <Field label="Last name"><Input value={p.last_name} onChange={(e) => setP({ ...p, last_name: e.target.value })} /></Field>
          <Field label="Phone"><Input value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} /></Field>
          <Field label="Birthday"><Input type="date" value={p.birthday} onChange={(e) => setP({ ...p, birthday: e.target.value })} /></Field>
        </div>
        <div className="mt-4 border-t border-slate-100 pt-3">
          <div className="mb-1 text-xs font-medium text-slate-500">Notification preferences</div>
          <Toggle label="Marketing email" checked={p.pref_marketing_email} onChange={(v) => setP({ ...p, pref_marketing_email: v })} />
          <Toggle label="SMS" checked={p.pref_sms} onChange={(v) => setP({ ...p, pref_sms: v })} />
          <Toggle label="Push" checked={p.pref_push} onChange={(v) => setP({ ...p, pref_push: v })} />
        </div>
        <div className="mt-3 flex items-center gap-3"><Button onClick={save}>Save</Button>{saved && <Badge tone="green">{saved}</Badge>}</div>
      </Card>

      {memberships.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">Memberships</h2>
          <div className="space-y-2">
            {memberships.map((m, i) => (
              <Card key={i} className="flex items-center gap-3 p-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: (m.brand?.primary_color || '#4f46e5') + '22' }}>
                  <SparkMark color={m.brand?.primary_color || '#4f46e5'} size={18} />
                </div>
                <div className="flex-1"><div className="font-medium text-ink">{m.brand?.name}</div><div className="text-xs text-slate-400">{m.tier}</div></div>
                <Badge tone="indigo">{m.points} pts</Badge>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Your data (KVKK / GDPR)</h2>
        <Card className="space-y-2 p-4">
          <Button variant="outline" className="w-full" onClick={exportData}>Download my data (JSON)</Button>
          <Button variant="outline" className="w-full" onClick={revokeAll}>Revoke consent from all brands</Button>
          <Button variant="danger" className="w-full" onClick={erase}>Erase my personal data</Button>
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Transparency Center</h2>
        <Card>
          {audit.length === 0 ? <p className="p-4 text-sm text-slate-400">No activity yet.</p> : (
            <ul className="divide-y divide-slate-100">
              {audit.map((a) => (
                <li key={a.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="text-slate-700">{a.action}</span>
                  <span className="text-xs text-slate-400">{new Date(a.created_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
