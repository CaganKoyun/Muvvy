import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Badge, Button, Card, Field, Input, PageTitle } from '../../components/ui';

export default function Campaigns() {
  const [list, setList] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [result, setResult] = useState<any>(null);

  async function load() { const r = await api.m('GET', '/v1/campaigns'); setList(r.campaigns ?? []); }
  useEffect(() => { load(); }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const r = await api.m('POST', '/v1/campaigns', { title, body: body || undefined });
    setResult(r); setTitle(''); setBody(''); await load();
  }

  return (
    <div>
      <PageTitle title="Campaigns" subtitle="Consent-safe by design — only shoppers who granted marketing are reached." />
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="h-fit p-5">
          <form onSubmit={send} className="space-y-3">
            <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Summer sale 🌞" required /></Field>
            <Field label="Message"><Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="30% off denim" /></Field>
            <Button>Send campaign</Button>
          </form>
          {result && (
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
              Delivered <b>{result.delivered}</b> · suppressed <b>{result.suppressed}</b> (no consent) of <b>{result.totalMembers}</b> members.
            </div>
          )}
        </Card>
        <Card>
          {list.length === 0 ? <p className="p-6 text-sm text-slate-400">No campaigns yet.</p> : (
            <ul className="divide-y divide-slate-100">
              {list.map((c) => (
                <li key={c.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <div className="font-medium text-ink">{c.title}</div>
                    <div className="text-xs text-slate-400">{c.body}</div>
                  </div>
                  <Badge tone="green">{c.deliveredCount} sent</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
