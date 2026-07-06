import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../../db';
import { useAuth } from '../../AuthContext';
import { Button, Card, Spinner, Wordmark } from '../../components/ui';

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<'working' | 'error' | 'done'>('working');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (loading) return;
    if (!session) { navigate(`/dashboard/login?next=/dashboard/accept?token=${token}`, { replace: true }); return; }
    db.acceptInvite(token)
      .then(() => { setState('done'); setTimeout(() => navigate('/dashboard'), 1200); })
      .catch((e) => { setState('error'); setMsg(e.message); });
  }, [loading, session, token]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm p-8 text-center">
        <div className="flex justify-center"><Wordmark /></div>
        <div className="mt-6">
          {state === 'working' && <Spinner />}
          {state === 'done' && <p className="text-emerald-600">Joined! Redirecting to your dashboard…</p>}
          {state === 'error' && (
            <>
              <p className="text-rose-600">{msg}</p>
              <Button className="mt-4" onClick={() => navigate('/dashboard')}>Go to dashboard</Button>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
