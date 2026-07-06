import { useEffect, useState } from 'react';
import { db } from '../../db';
import { Badge, Button, Card, Field, Input, Spinner } from '../../components/ui';

export default function Profile() {
  const [p, setP] = useState<any>({ first_name: '', last_name: '', phone: '', birthday: '', gender: '' });
  const [audit, setAudit] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState('');

  useEffect(() => {
    (async () => {
      const [prof, tr] = await Promise.all([db.profile(), db.transparency()]);
      if (prof) setP({ first_name: prof.first_name ?? '', last_name: prof.last_name ?? '', phone: prof.phone ?? '', birthday: prof.birthday ?? '', gender: prof.gender ?? '' });
      setAudit(tr);
      setLoading(false);
    })().catch(() => setLoading(false));
  }, []);

  async function save() {
    await db.saveProfile({ first_name: p.first_name || null, last_name: p.last_name || null, phone: p.phone || null, birthday: p.birthday || null, gender: p.gender || null });
    setSaved('Saved'); setTimeout(() => setSaved(''), 2000);
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-lg font-semibold text-ink">Profile & privacy</h1>
        <p className="text-sm text-slate-500">You own this data. Edit it once — brands only ever see what you consent to.</p>
      </div>

      <Card className="p-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name"><Input value={p.first_name} onChange={(e) => setP({ ...p, first_name: e.target.value })} /></Field>
          <Field label="Last name"><Input value={p.last_name} onChange={(e) => setP({ ...p, last_name: e.target.value })} /></Field>
          <Field label="Phone"><Input value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} /></Field>
          <Field label="Birthday"><Input type="date" value={p.birthday} onChange={(e) => setP({ ...p, birthday: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={save}>Save</Button>
          {saved && <Badge tone="green">{saved}</Badge>}
        </div>
      </Card>

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
