// POS / server-to-server: a store terminal creates a branded "Continue with
// Spark" request. Authenticated by the brand's machine API key (X-Api-Key:
// "<client_id>:<client_secret>"), verified against merchant_credentials.
//
//   supabase functions deploy pos-request
//   curl -X POST $URL/functions/v1/pos-request \
//     -H 'x-api-key: spark_client_x:secret_y' -H 'content-type: application/json' \
//     -d '{"branch_code":"AKASYA","reference":"POS-42"}'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json, sha256Hex } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const [clientId, clientSecret] = (req.headers.get('x-api-key') ?? '').split(':');
    if (!clientId || !clientSecret) return json({ error: 'missing api key' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: cred } = await admin
      .from('merchant_credentials')
      .select('merchant_id, client_secret_hash, status')
      .eq('client_id', clientId)
      .maybeSingle();
    if (!cred || cred.status !== 'active' || cred.client_secret_hash !== (await sha256Hex(clientSecret))) {
      return json({ error: 'invalid credentials' }, 401);
    }

    const body = await req.json().catch(() => ({}));
    // Resolve branch by code (optional) + the brand's Consent Engine config.
    let branchId: string | null = null;
    if (body.branch_code) {
      const { data: b } = await admin.from('branches').select('id').eq('merchant_id', cred.merchant_id).eq('code', body.branch_code).maybeSingle();
      branchId = b?.id ?? null;
    }
    const { data: fields } = await admin.from('merchant_requested_fields').select('scope_key, required').eq('merchant_id', cred.merchant_id);
    const requested = (fields ?? []).map((f) => f.scope_key);
    const required = (fields ?? []).filter((f) => f.required).map((f) => f.scope_key);
    if (requested.length === 0) return json({ error: 'no consent config' }, 400);

    const { data: reqRow, error } = await admin
      .from('identity_requests')
      .insert({ merchant_id: cred.merchant_id, branch_id: branchId, requested_scopes: requested, required_scopes: required, reference: body.reference ?? null })
      .select('id, request_token, expires_at')
      .single();
    if (error) return json({ error: error.message }, 400);

    return json({
      request_id: reqRow.id,
      request_token: reqRow.request_token,
      expires_at: reqRow.expires_at,
      qr: { deeplink: `spark://join?rt=${reqRow.request_token}` },
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
