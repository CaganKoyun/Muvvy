import { useEffect, useState } from 'react';
import { db } from '../../db';
import { Badge, Button, Card, PageTitle, Spinner } from '../../components/ui';

const money = (minor: number, cur = 'TRY') => minor === 0 ? 'Free' : `${(minor / 100).toLocaleString('tr-TR')} ${cur}/mo`;

export default function Billing() {
  const [summary, setSummary] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  async function load() {
    const [s, p] = await Promise.all([db.billingSummary(), db.listPlans()]);
    setSummary(s); setPlans(p ?? []); setLoading(false);
  }
  useEffect(() => { load().catch(() => setLoading(false)); }, []);

  async function upgrade(code: string) {
    setBusy(code);
    try { const r: any = await db.upgrade(code); if (!r?.redirected) await load(); } finally { setBusy(''); }
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;

  const used = summary?.used ?? 0;
  const included = summary?.included ?? 1;
  const pct = Math.min(100, Math.round((used / Math.max(included, 1)) * 100));
  const current = summary?.plan?.code;

  return (
    <div>
      <PageTitle title="Billing & plan" subtitle="Identity verifications this month, plan and usage." />

      <Card className="mb-8 p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase text-slate-400">Current plan</div>
            <div className="text-lg font-semibold text-ink">{summary?.plan?.name}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold text-ink">{used.toLocaleString()}<span className="text-sm text-slate-400"> / {included.toLocaleString()}</span></div>
            <div className="text-xs text-slate-400">identity verifications this month</div>
          </div>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-spark" style={{ width: `${pct}%` }} />
        </div>
        {summary?.overage > 0 && (
          <div className="mt-2 text-sm text-amber-600">Over quota by {summary.overage} — overage {money(summary.overage_minor)}.</div>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.code} className={`p-5 ${current === p.code ? 'ring-2 ring-spark' : ''}`}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-ink">{p.name}</h3>
              {current === p.code && <Badge tone="green">current</Badge>}
            </div>
            <div className="mt-1 text-2xl font-semibold text-ink">{money(p.monthly_price_minor, p.currency)}</div>
            <div className="mt-1 text-xs text-slate-400">{p.included_identities.toLocaleString()} identities included</div>
            <ul className="mt-3 space-y-1 text-sm text-slate-600">
              {(p.features ?? []).map((f: string) => <li key={f}>· {f}</li>)}
            </ul>
            {current !== p.code && (
              <Button className="mt-4 w-full" disabled={busy === p.code} onClick={() => upgrade(p.code)}>
                {busy === p.code ? <Spinner /> : p.monthly_price_minor > (summary?.plan?.monthly_price_minor ?? 0) ? 'Upgrade' : 'Switch'}
              </Button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
