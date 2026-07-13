-- ═══════════════════════════════════════════════════════════════════════════
-- Epic 2 — Pricing, packages & credits. A plan includes N identity
-- verifications per month; usage is metered from approved requests; overage is
-- priced per identity. Stripe wiring is a scaffolded Edge Function.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists plans (
  code text primary key,
  name text not null,
  monthly_price_minor int not null default 0,
  currency text not null default 'TRY',
  included_identities int not null default 0,
  overage_price_minor int not null default 0,   -- per identity beyond the included quota
  features jsonb not null default '[]',
  sort int not null default 0
);
insert into plans (code,name,monthly_price_minor,included_identities,overage_price_minor,features,sort) values
  ('starter','Starter',0,1000,0,'["1 brand","Unlimited branches","Consent handshake","Wallet & receipts"]',1),
  ('growth','Growth',499000,25000,15,'["Everything in Starter","Consent-safe campaigns","CRM/POS connectors","Team roles"]',2),
  ('enterprise','Enterprise',2499000,250000,8,'["Everything in Growth","Priority sync","SSO","Dedicated support","Mall network"]',3)
on conflict (code) do nothing;

create table if not exists subscriptions (
  merchant_id uuid primary key references merchants(id) on delete cascade,
  plan_code text not null references plans(code) default 'starter',
  status text not null default 'active',
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table plans enable row level security; alter table plans force row level security;
alter table subscriptions enable row level security; alter table subscriptions force row level security;
create policy plans_read on plans for select using (true);
create policy subs_member on subscriptions for select using (app.is_member(merchant_id));

-- Give every brand a Starter subscription at signup.
create or replace function create_brand(p_name text, p_slug text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from merchant_members where profile_id = v_uid) then raise exception 'already belongs to a brand'; end if;
  insert into merchants(name, slug, display_name) values (p_name, p_slug, p_name) returning id into v_id;
  insert into merchant_members(merchant_id, profile_id, role) values (v_id, v_uid, 'owner');
  insert into subscriptions(merchant_id, plan_code) values (v_id, 'starter') on conflict do nothing;
  update profiles set role = 'brand' where id = v_uid;
  return jsonb_build_object('merchant_id', v_id);
end; $$;

-- Usage + billing for the current calendar month.
create or replace function billing_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_merchant uuid := app.my_merchant(); v_plan plans; v_code text; v_used int; v_start timestamptz := date_trunc('month', now());
begin
  if v_merchant is null then raise exception 'not a brand member'; end if;
  select coalesce((select plan_code from subscriptions where merchant_id=v_merchant),'starter') into v_code;
  select * into v_plan from plans where code = v_code;
  select count(*) into v_used from identity_requests where merchant_id=v_merchant and status='approved' and decided_at >= v_start;
  return jsonb_build_object(
    'plan', to_jsonb(v_plan),
    'period_start', v_start,
    'used', v_used,
    'included', v_plan.included_identities,
    'remaining', greatest(v_plan.included_identities - v_used, 0),
    'overage', greatest(v_used - v_plan.included_identities, 0),
    'overage_minor', greatest(v_used - v_plan.included_identities, 0) * v_plan.overage_price_minor
  );
end; $$;

create or replace function list_plans()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(p) order by p.sort), '[]') from plans p;
$$;

-- Upgrade / change plan (admins). In production, gate this behind a paid Stripe
-- checkout; here it flips the plan immediately.
create or replace function change_plan(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_merchant uuid := app.my_merchant();
begin
  if not app.is_admin(v_merchant) then raise exception 'admins only'; end if;
  if not exists (select 1 from plans where code = p_code) then raise exception 'unknown plan'; end if;
  insert into subscriptions(merchant_id, plan_code) values (v_merchant, p_code)
    on conflict (merchant_id) do update set plan_code = excluded.plan_code, updated_at = now();
  insert into audit_log(actor_type,actor_id,action,merchant_id,metadata) values ('merchant',auth.uid(),'plan.changed',v_merchant,jsonb_build_object('plan',p_code));
  return jsonb_build_object('plan', p_code);
end; $$;

-- Backfill Starter for brands created before this migration.
insert into subscriptions (merchant_id, plan_code)
  select id, 'starter' from merchants where id not in (select merchant_id from subscriptions) on conflict do nothing;

grant execute on all functions in schema public to authenticated;
