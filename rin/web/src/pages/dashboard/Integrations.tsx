import { useEffect, useState } from 'react';
import { db, CONNECTOR_CATALOG } from '../../db';
import { Badge, Button, Card, Field, Input, PageTitle, Spinner } from '../../components/ui';

export default function Integrations() {
  const [connectors, setConnectors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<any>(null);
  const [apiKey, setApiKey] = useState('');
  const [url, setUrl] = useState('');

  async function load() { setConnectors(await db.connectors()); setLoading(false); }
  useEffect(() => { load().catch(() => setLoading(false)); }, []);

  async function connect() {
    if (!picked) return;
    await db.addConnector({
      kind: picked.kind, adapter: url ? 'rest' : 'log', name: picked.name,
      config: { apiKey, url: url || undefined }, is_primary: connectors.length === 0,
    });
    setPicked(null); setApiKey(''); setUrl(''); await load();
  }
  async function makePrimary(id: string) { await db.setPrimaryConnector(id); await load(); }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div>
      <PageTitle title="Integrations" subtitle="Connect your CRM/POS/ERP. Consented customers are routed into your primary solution." />
      {connectors.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">Connected</h2>
          <Card className="mb-8">
            <ul className="divide-y divide-slate-100">
              {connectors.map((c) => (
                <li key={c.id} className="flex items-center justify-between px-5 py-3">
                  <div><div className="font-medium text-ink">{c.name}</div><div className="text-xs uppercase text-slate-400">{c.kind} · {c.adapter}</div></div>
                  {c.is_primary ? <Badge tone="green">Primary solution</Badge> : <Button variant="outline" onClick={() => makePrimary(c.id)}>Make primary</Button>}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
      <h2 className="mb-2 text-sm font-semibold text-slate-500">Available tools</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {CONNECTOR_CATALOG.map((t) => (
          <button key={t.key} onClick={() => setPicked(t)}
            className={`rounded-xl border p-4 text-left transition ${picked?.key === t.key ? 'border-spark ring-2 ring-spark/20' : 'border-slate-200 hover:border-slate-300'}`}>
            <div className="font-medium text-ink">{t.name}</div>
            <div className="mt-1 text-xs uppercase text-slate-400">{t.kind}</div>
          </button>
        ))}
      </div>
      {picked && (
        <Card className="mt-6 max-w-md p-5">
          <h3 className="mb-3 font-semibold text-ink">Connect {picked.name}</h3>
          <div className="space-y-3">
            <Field label="API key"><Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk_live_…" /></Field>
            <Field label="Endpoint URL (optional)"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://crm.brand.com/ingest" /></Field>
            <div className="flex gap-2"><Button onClick={connect}>Connect</Button><Button variant="ghost" onClick={() => setPicked(null)}>Cancel</Button></div>
          </div>
        </Card>
      )}
    </div>
  );
}
