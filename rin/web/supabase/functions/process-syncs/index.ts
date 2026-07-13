// Drains pending connector_sync_logs and delivers them to each brand's CRM/POS
// endpoint (HMAC-signed), marking delivered/failed with attempt counts. Run on a
// schedule (supabase functions + cron) or invoke on demand.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json, hmacHex } from '../_shared/cors.ts';

const MAX_ATTEMPTS = 5;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: pending } = await admin
    .from('connector_sync_logs')
    .select('id, connector_id, merchant_id, operation, record, attempts')
    .eq('status', 'pending')
    .lt('attempts', MAX_ATTEMPTS)
    .limit(50);

  let delivered = 0, failed = 0, skipped = 0;
  for (const row of pending ?? []) {
    const { data: connector } = await admin.from('connectors').select('adapter, config').eq('id', row.connector_id).maybeSingle();
    const attempts = (row.attempts ?? 0) + 1;
    // 'log' adapter (or no URL) just records the sync as delivered.
    if (!connector || connector.adapter !== 'rest' || !connector.config?.url) {
      await admin.from('connector_sync_logs').update({ status: 'delivered', attempts }).eq('id', row.id);
      skipped++; continue;
    }
    try {
      const body = JSON.stringify({ operation: row.operation, record: row.record });
      const secret = (connector.config.secret as string) ?? 'whsec';
      const res = await fetch(connector.config.url as string, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-spark-signature': `sha256=${await hmacHex(secret, body)}` },
        body,
      });
      if (res.ok) {
        await admin.from('connector_sync_logs').update({ status: 'delivered', attempts, last_error: null }).eq('id', row.id);
        delivered++;
      } else {
        await admin.from('connector_sync_logs').update({ status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', attempts, last_error: `HTTP ${res.status}` }).eq('id', row.id);
        failed++;
      }
    } catch (e) {
      await admin.from('connector_sync_logs').update({ status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', attempts, last_error: String(e) }).eq('id', row.id);
      failed++;
    }
  }
  return json({ processed: (pending ?? []).length, delivered, failed, skipped });
});
