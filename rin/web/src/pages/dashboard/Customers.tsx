import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Badge, Card, PageTitle, Spinner } from '../../components/ui';

export default function Customers() {
  const [rows, setRows] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.m('GET', '/v1/customers').then((r) => { setRows(r.customers ?? []); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  async function open(grantId: string) {
    setDetail({ loading: true, grantId });
    const res = await api.m('GET', `/v1/customers/${grantId}`);
    setDetail({ grantId, ...res });
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div>
      <PageTitle title="Customers" subtitle="Your consented members — identified by grant, never by a shared id." />
      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <Card>
          {rows.length === 0 ? <p className="p-6 text-sm text-slate-400">No customers yet.</p> : (
            <ul className="divide-y divide-slate-100">
              {rows.map((c) => (
                <li key={c.grantId}>
                  <button onClick={() => open(c.grantId)} className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-slate-50">
                    <div>
                      <div className="font-mono text-xs text-slate-500">#{c.grantId.slice(0, 8)}</div>
                      <div className="text-xs text-slate-400">member since {new Date(c.memberSince).toLocaleDateString()}</div>
                    </div>
                    <Badge tone={c.status === 'active' ? 'green' : 'rose'}>{c.status}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="h-fit p-5">
          <h3 className="mb-3 font-semibold text-ink">Customer detail</h3>
          {!detail ? <p className="text-sm text-slate-400">Select a customer.</p> :
            detail.loading ? <Spinner /> :
            detail.status !== 'active' ? <Badge tone="rose">revoked — access withdrawn</Badge> : (
              <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{JSON.stringify(detail.customer, null, 2)}</pre>
            )}
        </Card>
      </div>
    </div>
  );
}
