import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { auth } from '../../auth';
import { Button, Card, Field, Input, Wordmark, ErrorText, Spinner, SparkMark } from '../../components/ui';

export default function AppLogin() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/app';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const res = mode === 'login'
        ? await api.login(email.trim(), password)
        : await api.register(email.trim(), password);
      auth.setConsumer(res.accessToken);
      navigate(next);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm p-8">
        <Link to="/"><Wordmark /></Link>
        <div className="mt-6 flex items-center gap-2 rounded-xl bg-spark/5 p-3">
          <SparkMark />
          <div className="text-sm font-medium text-ink">Continue with Spark</div>
        </div>
        <p className="mt-3 text-sm text-slate-500">One identity for every store. No forms at checkout, ever again.</p>
        <form onSubmit={submit} className="mt-5 space-y-3">
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required /></Field>
          <ErrorText>{err}</ErrorText>
          <Button className="w-full" disabled={busy}>{busy ? <Spinner /> : mode === 'login' ? 'Continue' : 'Create my identity'}</Button>
        </form>
        <button onClick={() => setMode(mode === 'login' ? 'register' : 'login')} className="mt-4 w-full text-center text-xs text-spark">
          {mode === 'login' ? 'New to Spark? Create an identity' : 'Have a Spark identity? Sign in'}
        </button>
      </Card>
    </div>
  );
}
