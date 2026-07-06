import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { auth } from '../../auth';
import { Button, Card, Spinner, SparkMark, Badge } from '../../components/ui';

export default function Consent() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState<any>(null);
  const [granted, setGranted] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState('');
  const [done, setDone] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!auth.consumerToken()) {
      navigate(`/app/login?next=/app/consent/${token}`, { replace: true });
      return;
    }
    api.c('GET', `/v1/consent/requests/${token}`).then((v) => {
      setView(v);
      const g: Record<string, boolean> = {};
      for (const s of v.requested) g[s.key] = v.requiredScopes.includes(s.key);
      setGranted(g);
    }).catch((e) => setErr(e.message));
  }, [token]);

  const brandColor = view?.brand?.primaryColor || '#4f46e5';
  const selected = useMemo(() => Object.keys(granted).filter((k) => granted[k]), [granted]);

  async function approve() {
    setBusy(true); setErr('');
    try {
      const res = await api.c('POST', `/v1/consent/requests/${token}/approve`, { grantedScopes: selected });
      setDone(res);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function deny() { await api.c('POST', `/v1/consent/requests/${token}/deny`).catch(() => {}); navigate('/app'); }

  if (err && !view) return <div className="flex min-h-screen items-center justify-center p-6 text-sm text-rose-600">{err}</div>;
  if (!view) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-sm p-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">✓</div>
          <h1 className="text-lg font-semibold text-ink">Connected to {view.brand.name}</h1>
          <p className="mt-1 text-sm text-slate-500">The brand was added to your app. You shared {selected.length} item(s).</p>
          <div className="mt-6 space-y-2">
            {done.redirect && <a href={done.redirect} target="_blank" rel="noreferrer"><Button className="w-full">Continue to {view.brand.name}</Button></a>}
            <Button variant="outline" className="w-full" onClick={() => navigate('/app')}>Go to my brands</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm overflow-hidden">
        {/* Branded header */}
        <div className="px-6 py-6 text-center text-white" style={{ background: brandColor }}>
          {view.brand.logoUrl ? (
            <img src={view.brand.logoUrl} alt={view.brand.name} className="mx-auto h-12 w-12 rounded-xl bg-white object-contain p-1" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
          ) : (
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-white"><SparkMark color={brandColor} /></div>
          )}
          <h1 className="mt-3 text-lg font-semibold">{view.brand.name}</h1>
          {view.branch && <p className="text-sm opacity-90">{view.branch.name}</p>}
        </div>

        <div className="p-6">
          <p className="text-sm text-slate-500">wants to connect with your Spark identity and access:</p>
          <div className="mt-4 space-y-1">
            {view.requested.map((s: any) => {
              const req = view.requiredScopes.includes(s.key);
              return (
                <label key={s.key} className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-slate-50">
                  <span className="text-sm text-slate-700">{s.label} {req && <Badge tone="slate">required</Badge>}</span>
                  <input type="checkbox" checked={!!granted[s.key]} disabled={req}
                    onChange={(e) => setGranted({ ...granted, [s.key]: e.target.checked })} />
                </label>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-slate-400">You can revoke any brand with one tap, anytime.</p>
          {err && <p className="mt-2 text-sm text-rose-600">{err}</p>}
          <div className="mt-5 space-y-2">
            <Button className="w-full" style={{ background: brandColor }} disabled={busy} onClick={approve}>{busy ? <Spinner /> : 'Approve & connect'}</Button>
            <Button variant="ghost" className="w-full" onClick={deny}>Not now</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
