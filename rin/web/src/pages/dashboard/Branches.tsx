import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Badge, Button, Card, Field, Input, PageTitle, Spinner } from '../../components/ui';

export default function Branches() {
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', code: '', city: '' });
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await api.m('GET', '/v1/merchant/branches');
    setBranches(res.branches ?? []);
    setLoading(false);
  }
  useEffect(() => { load().catch(() => setLoading(false)); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.m('POST', '/v1/merchant/branches', {
        name: form.name,
        code: form.code.toUpperCase(),
        city: form.city || undefined,
      });
      setForm({ name: '', code: '', city: '' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageTitle title="Branches" subtitle="Each store (şube) generates its own branded QR." />
      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <Card>
          {loading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : branches.length === 0 ? (
            <p className="p-6 text-sm text-slate-400">No branches yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {branches.map((b) => (
                <li key={b.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <div className="font-medium text-ink">{b.name}</div>
                    <div className="text-xs text-slate-500">{b.city || '—'}</div>
                  </div>
                  <Badge>{b.code}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="h-fit p-5">
          <h3 className="mb-3 font-semibold text-ink">Add branch</h3>
          <form onSubmit={add} className="space-y-3">
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="LC Waikiki Kanyon" required /></Field>
            <Field label="Code"><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="KANYON" required /></Field>
            <Field label="City"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="İstanbul" /></Field>
            <Button className="w-full" disabled={busy}>Add branch</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
