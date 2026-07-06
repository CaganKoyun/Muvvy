import { useEffect, useState } from 'react';
import { db } from '../../db';
import { Card, PageTitle, Spinner, Stat } from '../../components/ui';

export default function Malls() {
  const [malls, setMalls] = useState<any[]>([]);
  const [sel, setSel] = useState<string>('');
  const [dash, setDash] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    db.malls().then((m) => { setMalls(m); if (m[0]) select(m[0].id); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  async function select(id: string) { setSel(id); setDash(await db.mallDashboard(id)); }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div>
      <PageTitle title="Malls" subtitle="Mall-wide identity across the stores you participate in." />
      {malls.length === 0 ? <Card className="p-6 text-sm text-slate-400">This brand isn’t part of a mall yet.</Card> : (
        <>
          <div className="mb-6 flex flex-wrap gap-2">
            {malls.map((m) => (
              <button key={m.id} onClick={() => select(m.id)} className={`rounded-lg border px-4 py-2 text-sm ${sel === m.id ? 'border-spark text-spark' : 'border-slate-200 text-slate-600'}`}>
                {m.name}
              </button>
            ))}
          </div>
          {dash && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Identified shoppers" value={dash.identifiedShoppers} hint="distinct across stores" />
              <Stat label="Store participation" value={dash.storeParticipation} />
              <Stat label="Store memberships" value={dash.totalStoreMemberships} />
              <Stat label="Cross-store shoppers" value={dash.crossStoreShoppers} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
