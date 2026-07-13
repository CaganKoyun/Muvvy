import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../../db';
import { Button, Card, Field, Input, Wordmark, ErrorText, Spinner } from '../../components/ui';

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export default function Signup() {
  const [brand, setBrand] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg(''); setBusy(true);
    try {
      const { data, error } = await db.signUp(email.trim(), password, 'brand', brand);
      if (error) throw error;
      if (!data.session) { setMsg('Check your email to confirm, then sign in and finish setup.'); return; }
      await db.createBrand(brand, slugify(brand) + '-' + Math.random().toString(36).slice(2, 6));
      navigate('/dashboard');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md p-8">
        <Link to="/"><Wordmark /></Link>
        <h1 className="mt-6 text-xl font-semibold text-ink">Create your brand</h1>
        <p className="mt-1 text-sm text-slate-500">Start onboarding consented customers across your stores.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Brand name"><Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Mavi" required /></Field>
          <Field label="Work email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required /></Field>
          <ErrorText>{err}</ErrorText>
          {msg && <p className="text-sm text-emerald-600">{msg}</p>}
          <Button className="w-full" disabled={busy}>{busy ? <Spinner /> : 'Create brand'}</Button>
        </form>
        <p className="mt-6 text-center text-xs text-slate-400">
          Already have an account? <Link to="/dashboard/login" className="text-spark">Sign in</Link>
        </p>
      </Card>
    </div>
  );
}
