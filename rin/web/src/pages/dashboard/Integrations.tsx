import { useEffect, useState } from 'react';
import { db, CONNECTOR_CATALOG } from '../../db';
import { Badge, Button, Card, Field, Input, PageTitle, Spinner } from '../../components/ui';

const MAP_FIELDS = [
  ['profile.email', 'Email'],
  ['profile.phone', 'Phone'],
  ['profile.name', 'Name'],
  ['profile.birthday', 'Birthday'],
];

export default function Integrations() {
  const [connectors, setConnectors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<any>(null);
  const [apiKey, setApiKey] = useState('');
  const [url, setUrl] = useState('');
  const [open, setOpen] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  async function load() { setConnectors(await db.connectors()); setLoading(false); }
  useEffect(() => { load().catch(() => setLoading(false)); }, []);

  async function connect() {
    if (!picked) return;
    await db.addConnector({ kind: picked.kind, adapter: url ? 'rest' : 'log', name: picked.name, config: { apiKey, url: url || undefined }, is_primary: connectors.length === 0 });
    setPicked(null); setApiKey(''); setUrl(''); await load();
  }
  async function makePrimary(id: string) { await db.setPrimaryConnector(id); await load(); }
  async function openDetail(c: any) {
    setOpen(c); setMapping((c.config?.mapping as any) ?? {});
    setLogs(await db.syncLogs(c.id));
  }
  async function saveMapping() { await db.setMapping(open.id, mapping); await load(); }
  async function retry(id: string) { await db.retrySync(id); setLogs(await db.syncLogs(open.id)); }
  async function runSyncs() { await db.runSyncs(); if (open) setLogs(await db.syncLogs(open.id)); }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div>
      <PageTitle title="Integrations" subtitle="Connect CRM/POS/ERP. Consented customers auto-sync into your primary solution." action={<Button variant="outline" onClick={runSyncs}>Run pending syncs</Button>} />

      {connectors.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">Connected</h2>
          <Card className="mb-6">
            <ul className="divide-y divide-slate-100">
              {connectors.map((c) => (
                <li key={c.id} className="flex items-center justify-between px-5 py-3">
                  <button className="text-left" onClick={() => openDetail(c)}>
                    <div className="font-medium text-ink">{c.name}</div>
                    <div className="text-xs uppercase text-slate-400">{c.kind} · {c.adapter} · configure ↓</div>
                  </button>
                  {c.is_primary ? <Badge tone="green">Primary</Badge> : <Button variant="outline" onClick={() => makePrimary(c.id)}>Make primary</Button>}
                </li>
              ))}
            </ul>
          </Card>

          {open && (
            <Card className="mb-8 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-ink">{open.name} — field mapping & sync</h3>
                <Button variant="ghost" onClick={() => setOpen(null)}>Close</Button>
              </div>
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs font-medium text-slate-500">Map Spark fields → your CRM fields</div>
                  {MAP_FIELDS.map(([src, def]) => (
                    <div key={src} className="mb-2 flex items-center gap-2">
                      <code className="w-28 text-xs text-slate-500">{src}</code>
                      <span className="text-slate-300">→</span>
                      <Input value={mapping[src] ?? ''} placeholder={def} onChange={(e) => setMapping({ ...mapping, [src]: e.target.value })} />
                    </div>
                  ))}
                  <Button className="mt-2" onClick={saveMapping}>Save mapping</Button>
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium text-slate-500">Recent syncs</div>
                  {logs.length === 0 ? <p className="text-sm text-slate-400">No syncs yet.</p> : (
                    <ul className="max-h-64 space-y-1 overflow-y-auto">
                      {logs.map((l) => (
                        <li key={l.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                          <span className="text-slate-600">{l.operation}</span>
                          <span className="flex items-center gap-2">
                            <Badge tone={l.status === 'delivered' ? 'green' : l.status === 'failed' ? 'rose' : 'amber'}>{l.status}</Badge>
                            {l.status === 'failed' && <Button variant="ghost" onClick={() => retry(l.id)}>Retry</Button>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </Card>
          )}
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
            <Field label="Endpoint URL (for auto-sync)"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://crm.brand.com/ingest" /></Field>
            <div className="flex gap-2"><Button onClick={connect}>Connect</Button><Button variant="ghost" onClick={() => setPicked(null)}>Cancel</Button></div>
          </div>
        </Card>
      )}
    </div>
  );
}
