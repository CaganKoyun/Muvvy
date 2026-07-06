import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

interface AuthState {
  session: Session | null;
  role: 'brand' | 'consumer' | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState>({ session: null, role: null, loading: true, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<'brand' | 'consumer' | null>(null);
  const [loading, setLoading] = useState(true);

  async function resolveRole(s: Session | null) {
    if (!s) return setRole(null);
    const { data } = await supabase.from('profiles').select('role').eq('id', s.user.id).maybeSingle();
    setRole((data?.role as 'brand' | 'consumer') ?? 'consumer');
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await resolveRole(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s);
      await resolveRole(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <Ctx.Provider value={{ session, role, loading, signOut: async () => void (await supabase.auth.signOut()) }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
