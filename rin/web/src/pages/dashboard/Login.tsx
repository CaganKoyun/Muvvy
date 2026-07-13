import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../../db';
import { Button, Card, Field, Input, Wordmark, ErrorText, Spinner } from '../../components/ui';

export default function DashLogin() {
  const [email, setEmail] = useState('owner@lcwaikiki.com');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setBusy(true);
    const { error } = await db.signIn(email.trim(), password);
    setBusy(false);
    if (error) return setErr(error.message);
    navigate('/dashboard');
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md p-8">
        <Link to="/"><Wordmark /></Link>
        <h1 className="mt-6 text-xl font-semibold text-ink">Brand sign in</h1>
        <p className="mt-1 text-sm text-slate-500">Seed brand: <code className="text-xs">owner@lcwaikiki.com</code> / <code className="text-xs">password123</code></p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          <ErrorText>{err}</ErrorText>
          <Button className="w-full" disabled={busy}>{busy ? <Spinner /> : 'Sign in'}</Button>
        </form>
        <p className="mt-6 text-center text-xs text-slate-400">
          New brand? <Link to="/dashboard/signup" className="text-spark">Create an account</Link>
          {' · '}Shopper? <Link to="/app/login" className="text-spark">Continue with Spark</Link>
        </p>
      </Card>
    </div>
  );
}
