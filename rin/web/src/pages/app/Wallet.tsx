import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Badge, Card, Spinner } from '../../components/ui';

const money = (minor: number, cur = 'TRY') => `${(minor / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${cur}`;

export default function Wallet() {
  const [wallet, setWallet] = useState<any>(null);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [warranties, setWarranties] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.c('GET', '/v1/me/wallet'),
      api.c('GET', '/v1/me/receipts'),
      api.c('GET', '/v1/me/warranties'),
    ]).then(([w, r, wa]) => {
      setWallet(w); setReceipts(r.receipts ?? []); setWarranties(wa.warranties ?? []); setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;

  const coupons = wallet?.coupons ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-lg font-semibold text-ink">Wallet</h1>
        <p className="text-sm text-slate-500">Receipts, warranties and coupons in one place.</p>
      </div>

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
        {receipts.length === 0 ? <Card className="p-4 text-sm text-slate-400">No receipts.</Card> : receipts.map((r: any) => (
          <Card key={r.id} className="mb-2 flex items-center justify-between p-4">
            <div><div className="font-medium text-ink">{r.storeName || 'Purchase'}</div><div className="text-xs text-slate-400">{new Date(r.purchasedAt).toLocaleDateString()}</div></div>
            <div className="font-semibold text-ink">{money(r.totalMinor, r.currency)}</div>
          </Card>
        ))}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Warranties</h2>
        {warranties.length === 0 ? <Card className="p-4 text-sm text-slate-400">No warranties.</Card> : warranties.map((w: any) => (
          <Card key={w.id} className="mb-2 flex items-center justify-between p-4">
            <div><div className="font-medium text-ink">{w.itemName}</div><div className="text-xs text-slate-400">{w.months} months</div></div>
            <Badge tone="amber">until {new Date(w.expiresAt).toLocaleDateString()}</Badge>
          </Card>
        ))}
      </section>
    </div>
  );
}
