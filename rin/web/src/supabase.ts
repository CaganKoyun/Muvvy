import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anon) {
  // eslint-disable-next-line no-console
  console.warn('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (.env) to connect to Supabase.');
}

export const supabase = createClient(url ?? 'http://localhost', anon ?? 'anon');
