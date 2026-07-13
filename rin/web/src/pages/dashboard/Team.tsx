import { useEffect, useState } from 'react';
import { db } from '../../db';
import { Badge, Button, Card, Field, Input, PageTitle, Spinner } from '../../components/ui';

const ROLES = ['admin', 'branch_manager', 'staff'];

export default function Team() {
  const [members, setMembers] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ email: '', role: 'staff', branch_id: '' });
  const [lastInvite, setLastInvite] = useState<any>(null);
  const [err, setErr] = useState('');

  async function load() {
    const [m, i, b] = await Promise.all([db.teamMembers(), db.listInvites().catch(() => []), db.branches()]);
    setMembers(m ?? []); setInvites(i ?? []); setBranches(b ?? []); setLoading(false);
  }
  useEffect(() => { load().catch(() => setLoading(false)); }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    try {
      const inv = await db.createInvite(form.email.trim(), form.role, form.branch_id || undefined);
      setLastInvite(inv); setForm({ email: '', role: 'staff', branch_id: '' }); await load();
    } catch (e: any) { setErr(e.message); }
  }
  async function revoke(id: string) { await db.revokeInvite(id); await load(); }
  async function remove(pid: string) { await db.removeMember(pid).catch((e) => setErr(e.message)); await load(); }
  async function setRole(pid: string, role: string) { await db.updateMember(pid, role).catch((e) => setErr(e.message)); await load(); }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;
  const inviteLink = lastInvite ? `${window.location.origin}/dashboard/accept?token=${lastInvite.token}` : '';

  return (
    <div>
      <PageTitle title="Team" subtitle="Invite colleagues and scope them to a branch." />
      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <div className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-500">Members</div>
            <ul className="divide-y divide-slate-100">
              {members.map((m) => (
                <li key={m.profile_id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <div className="font-medium text-ink">{m.email}</div>
                    <div className="text-xs text-slate-400">{m.branch_id ? 'branch-scoped' : 'all branches'}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {m.role === 'owner' ? <Badge tone="indigo">owner</Badge> : (
                      <>
                        <select value={m.role} onChange={(e) => setRole(m.profile_id, e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-xs">
                          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                        <Button variant="ghost" className="text-rose-600" onClick={() => remove(m.profile_id)}>Remove</Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          {invites.length > 0 && (
            <Card>
              <div className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-500">Pending invites</div>
              <ul className="divide-y divide-slate-100">
                {invites.map((i) => (
                  <li key={i.id} className="flex items-center justify-between px-5 py-3">
                    <div><div className="font-medium text-ink">{i.email}</div><Badge>{i.role}</Badge></div>
                    <Button variant="ghost" className="text-rose-600" onClick={() => revoke(i.id)}>Revoke</Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card className="h-fit p-5">
          <h3 className="mb-3 font-semibold text-ink">Invite a colleague</h3>
          <form onSubmit={invite} className="space-y-3">
            <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
            <Field label="Role">
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            {form.role === 'branch_manager' && (
              <Field label="Branch">
                <select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option value="">— pick branch —</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            )}
            <Button className="w-full">Create invite</Button>
          </form>
          {err && <p className="mt-2 text-sm text-rose-600">{err}</p>}
          {lastInvite && (
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs">
              <div className="mb-1 font-medium text-slate-600">Share this invite link:</div>
              <code className="break-all text-slate-500">{inviteLink}</code>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
