import { useEffect, useState } from 'react';
import { db } from '../../db';
import { Badge, Card, Spinner } from '../../components/ui';

export default function Notifications() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() { setItems(await db.notifications()); setLoading(false); }
  useEffect(() => { load().catch(() => setLoading(false)); }, []);
  async function read(id: string) { await db.markRead(id); await load(); }

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-ink">Alerts</h1>
      <p className="mb-4 text-sm text-slate-500">Campaigns, coupons and warranty reminders.</p>
      {items.length === 0 ? <Card className="p-6 text-center text-sm text-slate-400">Nothing yet.</Card> : (
        <div className="space-y-2">
          {items.map((n) => (
            <Card key={n.id} className={`p-4 ${n.read ? 'opacity-60' : ''}`} onClick={() => !n.read && read(n.id)}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-ink">{n.title}</div>
                  {n.body && <div className="text-sm text-slate-500">{n.body}</div>}
                  <div className="mt-1 text-xs text-slate-400">{new Date(n.created_at).toLocaleString()}</div>
                </div>
                <Badge tone={n.type === 'warranty_expiry' ? 'amber' : 'indigo'}>{n.type.replace('_', ' ')}</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
