import { useEffect, useState } from 'react';
import { db } from '../../db';
import { Badge, Card, PageTitle, Stat, Spinner } from '../../components/ui';

export default function Overview() {
  const [brand, setBrand] = useState<any>(null);
  const [dash, setDash] = useState<any>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [me, d, cs] = await Promise.all([db.myMerchant(), db.dashboard(), db.customers()]);
      setBrand(me); setDash(d); setCustomers(cs ?? []); setLoading(false);
    })().catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div>
      <PageTitle title={`Welcome, ${brand?.display_name || brand?.name || 'Brand'}`} subtitle="Live overview of your Spark identity network." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="New members" value={dash?.newMembers ?? 0} />
        <Stat label="Consent rate" value={`${Math.round((dash?.consentRate ?? 0) * 100)}%`} />
        <Stat label="Avg checkout" value={dash?.avgCheckoutSeconds != null ? `${dash.avgCheckoutSeconds}s` : '—'} />
        <Stat label="Active grants" value={dash?.activeGrants ?? 0} />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-slate-500">Recent customers</h2>
      <Card>
        {customers.length === 0 ? (
          <p className="p-6 text-sm text-slate-400">No customers yet — generate a QR to onboard your first member.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {customers.map((c) => (
              <li key={c.grant_id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <div className="font-mono text-xs text-slate-500">#{String(c.grant_id).slice(0, 8)}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {(c.granted_scopes ?? []).map((s: string) => <Badge key={s} tone="indigo">{s.split(':')[1]}</Badge>)}
                  </div>
                </div>
                <Badge tone={c.status === 'active' ? 'green' : 'rose'}>{c.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
