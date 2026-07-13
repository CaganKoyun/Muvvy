import { useEffect, useState } from 'react';
import { db } from '../../db';
import { Badge, Button, Card, Spinner, SparkMark } from '../../components/ui';

export default function Connected() {
  const [grants, setGrants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() { setGrants(await db.myBrands()); setLoading(false); }
  useEffect(() => { load().catch(() => setLoading(false)); }, []);
  async function revoke(id: string) { await db.revoke(id); await load(); }

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-ink">My brands</h1>
      <p className="mb-4 text-sm text-slate-500">Every store you’ve connected — you’re in control.</p>
      {grants.length === 0 ? (
        <Card className="p-6 text-center text-sm text-slate-400">No brands yet. Scan a store’s QR to connect.</Card>
      ) : (
        <div className="space-y-3">
          {grants.map((g) => (
            <Card key={g.grant_id} className="p-4">
              <div className="flex items-center gap-3">
                {g.brand?.logo_url ? (
                  <img src={g.brand.logo_url} className="h-10 w-10 rounded-lg object-contain" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: (g.brand?.primary_color || '#4f46e5') + '22' }}>
                    <SparkMark color={g.brand?.primary_color || '#4f46e5'} size={20} />
                  </div>
                )}
                <div className="flex-1">
                  <div className="font-medium text-ink">{g.brand?.name}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {(g.granted_scopes ?? []).map((s: string) => <Badge key={s}>{s.split(':')[1]}</Badge>)}
                  </div>
                </div>
                {g.status === 'active'
                  ? <Button variant="ghost" onClick={() => revoke(g.grant_id)} className="text-rose-600">Revoke</Button>
                  : <Badge tone="rose">revoked</Badge>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
