import { useEffect, useState } from 'react';
import { db } from '../../db';
import { Badge, Card, Spinner } from '../../components/ui';

const money = (minor: number, cur = 'TRY') => `${(minor / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${cur}`;

export default function Wallet() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { db.wallet().then((d) => { setData(d); setLoading(false); }).catch(() => setLoading(false)); }, []);
  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;

  const coupons = (data.items ?? []).filter((i: any) => i.type === 'coupon');

  return (
    <div className="space-y-6">
      <div><h1 className="mb-1 text-lg font-semibold text-ink">Wallet</h1><p className="text-sm text-slate-500">Receipts, warranties and coupons in one place.</p></div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Coupons</h2>
        {coupons.length === 0 ? <Card className="p-4 text-sm text-slate-400">No coupons.</Card> : coupons.map((c: any) => (
          <Card key={c.id} className="mb-2 flex items-center justify-between p-4">
            <div><div className="font-medium text-ink">{c.title}</div><div className="text-xs text-slate-400">{c.code}</div></div>
            <Badge tone="indigo">coupon</Badge>
          </Card>
        ))}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Receipts</h2>
        {(data.receipts ?? []).length === 0 ? <Card className="p-4 text-sm text-slate-400">No receipts.</Card> : data.receipts.map((r: any) => (
          <Card key={r.id} className="mb-2 flex items-center justify-between p-4">
            <div><div className="font-medium text-ink">{r.store_name || 'Purchase'}</div><div className="text-xs text-slate-400">{new Date(r.purchased_at).toLocaleDateString()}</div></div>
            <div className="font-semibold text-ink">{money(r.total_minor, r.currency)}</div>
          </Card>
        ))}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Warranties</h2>
        {(data.warranties ?? []).length === 0 ? <Card className="p-4 text-sm text-slate-400">No warranties.</Card> : data.warranties.map((w: any) => (
          <Card key={w.id} className="mb-2 flex items-center justify-between p-4">
            <div><div className="font-medium text-ink">{w.item_name}</div><div className="text-xs text-slate-400">{w.months} months</div></div>
            <Badge tone="amber">until {new Date(w.expires_at).toLocaleDateString()}</Badge>
          </Card>
        ))}
      </section>
    </div>
  );
}
