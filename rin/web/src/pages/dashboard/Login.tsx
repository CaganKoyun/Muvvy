import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { auth } from '../../auth';
import { Button, Card, Field, Input, Wordmark, ErrorText, Spinner } from '../../components/ui';

export default function DashLogin() {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const res = await api.merchantToken(clientId.trim(), clientSecret.trim());
      auth.setMerchant(res.access_token);
      navigate('/dashboard');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md p-8">
        <Link to="/"><Wordmark /></Link>
        <h1 className="mt-6 text-xl font-semibold text-ink">Brand sign in</h1>
        <p className="mt-1 text-sm text-slate-500">Use your Spark client credentials (from <code className="text-xs">npm run seed</code>).</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Client ID">
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="spark_client_…" />
          </Field>
          <Field label="Client Secret">
            <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="secret_…" />
          </Field>
          <ErrorText>{err}</ErrorText>
          <Button className="w-full" disabled={busy}>{busy ? <Spinner /> : 'Sign in'}</Button>
        </form>
        <p className="mt-6 text-center text-xs text-slate-400">
          Looking for the shopper app? <Link to="/app/login" className="text-spark">Continue with Spark</Link>
        </p>
      </Card>
    </div>
  );
}
