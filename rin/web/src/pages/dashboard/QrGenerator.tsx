import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../../api';
import { Badge, Button, Card, PageTitle, Spinner } from '../../components/ui';

export default function QrGenerator() {
  const [branches, setBranches] = useState<any[]>([]);
  const [branchId, setBranchId] = useState('');
  const [req, setReq] = useState<any>(null);
  const [qr, setQr] = useState('');
  const [status, setStatus] = useState<string>('');
  const [customer, setCustomer] = useState<any>(null);
  const poll = useRef<number | null>(null);

  useEffect(() => {
    api.m('GET', '/v1/merchant/branches').then((r) => {
      setBranches(r.branches ?? []);
      if (r.branches?.[0]) setBranchId(r.branches[0].id);
    });
    return () => { if (poll.current) window.clearInterval(poll.current); };
  }, []);

  async function generate() {
    setCustomer(null);
    const r = await api.m('POST', '/v1/identity/requests', { branchId: branchId || undefined, reference: 'POS-web' });
    setReq(r);
    setStatus('pending');
    const consentUrl = `${window.location.origin}/app/consent/${r.requestToken}`;
    setQr(await QRCode.toDataURL(consentUrl, { width: 240, margin: 1, color: { dark: '#0b1020' } }));
    if (poll.current) window.clearInterval(poll.current);
    poll.current = window.setInterval(async () => {
      const res = await api.m('GET', `/v1/identity/requests/${r.requestId}`);
      setStatus(res.status);
      if (res.status === 'approved') {
        setCustomer(res.customer);
        if (poll.current) window.clearInterval(poll.current);
      }
    }, 1500);
  }

  return (
    <div>
      <PageTitle title="Generate QR" subtitle="Show this at the till — the shopper scans to see your branded consent screen." />
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-5">
          <label className="text-xs font-medium text-slate-500">Branch (şube)</label>
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
          </select>
          <Button className="mt-4 w-full" onClick={generate}>Generate branded QR</Button>

          {qr && (
            <div className="mt-6 flex flex-col items-center">
              <img src={qr} alt="QR" className="rounded-xl border border-slate-200 p-2" />
              <div className="mt-3 flex items-center gap-2 text-sm">
                Status: <Badge tone={status === 'approved' ? 'green' : status === 'pending' ? 'amber' : 'slate'}>{status}</Badge>
                {status === 'pending' && <Spinner />}
              </div>
              <p className="mt-1 text-center text-xs text-slate-400">Open <code>/app/consent/{req?.requestToken?.slice(0, 10)}…</code> to simulate a scan.</p>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold text-ink">Consented customer</h3>
          {!customer ? (
            <p className="mt-2 text-sm text-slate-400">Waiting for the shopper to approve…</p>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">New member onboarded — routed into your primary solution.</div>
              <div>
                <div className="mb-1 text-xs font-medium text-slate-500">Profile (only consented fields)</div>
                <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{JSON.stringify(customer.profile, null, 2)}</pre>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-slate-500">Permissions</div>
                <div className="flex flex-wrap gap-1">
                  {Object.keys(customer.permissions || {}).map((p) => <Badge key={p} tone="indigo">{p}</Badge>)}
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
