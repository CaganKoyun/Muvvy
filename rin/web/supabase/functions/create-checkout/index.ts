// Stripe checkout scaffold. Wire STRIPE_SECRET_KEY + price ids to turn plan
// changes into real paid upgrades. Until then it returns the plan directly so
// `change_plan` can flip it (dev). In production: create a Stripe Checkout
// Session for the plan's price and return session.url; a `stripe-webhook`
// function then calls `change_plan` on `checkout.session.completed`.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json } from '../_shared/cors.ts';

const PRICE_IDS: Record<string, string | undefined> = {
  growth: Deno.env.get('STRIPE_PRICE_GROWTH'),
  enterprise: Deno.env.get('STRIPE_PRICE_ENTERPRISE'),
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { plan_code } = await req.json();
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey || !PRICE_IDS[plan_code]) {
      // Dev mode: no Stripe configured — the client falls back to change_plan.
      return json({ configured: false, plan_code });
    }
    // Verify the caller (a brand admin) via their Supabase JWT.
    const authed = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { authorization: req.headers.get('authorization') ?? '' } },
    });
    const { data: me } = await authed.auth.getUser();
    if (!me.user) return json({ error: 'unauthorized' }, 401);

    const params = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': PRICE_IDS[plan_code]!,
      'line_items[0][quantity]': '1',
      success_url: `${req.headers.get('origin')}/dashboard/billing?ok=1`,
      cancel_url: `${req.headers.get('origin')}/dashboard/billing`,
      'metadata[plan_code]': plan_code,
      'metadata[user_id]': me.user.id,
    });
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { authorization: `Bearer ${stripeKey}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const session = await res.json();
    return json({ configured: true, url: session.url });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
