// Route a consented customer into the brand's PRIMARY solution (CRM/POS/ERP).
// Given a grant id, it resolves the disclosed (consented-only) record and POSTs
// it, HMAC-signed, to the brand's primary connector endpoint. Call this after
// approval (e.g. from a DB webhook / pg_net trigger, or the app).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json, hmacHex } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { grant_id } = await req.json();
    if (!grant_id) return json({ error: 'grant_id required' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: grant } = await admin.from('consent_grants').select('id, merchant_id, status').eq('id', grant_id).maybeSingle();
    if (!grant || grant.status !== 'active') return json({ error: 'no active grant' }, 404);

    // Disclosure via the same RPC the app uses (never leaks the raw identity id).
    const { data: customer } = await admin.rpc('get_customer', { p_grant_id: grant_id });

    const { data: connector } = await admin
      .from('connectors')
      .select('id, config')
      .eq('merchant_id', grant.merchant_id)
      .eq('is_primary', true)
      .eq('active', true)
      .maybeSingle();

    const record = { operation: 'upsert_customer', customerRef: grant_id, ...customer };
    let status = 'logged';
    if (connector?.config?.url) {
      const secret = (connector.config.secret as string) ?? 'whsec';
      const bodyStr = JSON.stringify(record);
      const res = await fetch(connector.config.url as string, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-spark-signature': `sha256=${await hmacHex(secret, bodyStr)}` },
        body: bodyStr,
      }).catch(() => null);
      status = res?.ok ? 'delivered' : 'failed';
    }
    if (connector) {
      await admin.from('connector_sync_logs').insert({ connector_id: connector.id, merchant_id: grant.merchant_id, operation: 'upsert_customer', record, status });
    }
    return json({ routed: true, connector: connector?.id ?? null, status });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
