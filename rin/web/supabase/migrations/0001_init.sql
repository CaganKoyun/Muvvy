-- ═══════════════════════════════════════════════════════════════════════════
-- Spark Retail Identity Network (RIN) — Supabase schema
-- Identity & consent layer for physical commerce. "One identity, every store."
--
-- Security model: RLS is FORCED on every table; privileged / cross-tenant logic
-- lives in SECURITY DEFINER functions (RPCs). The privacy invariant — a brand
-- never sees the raw Spark identity id, only a per-grant handle and the scopes
-- the shopper consented to — is enforced in `get_customer` / `list_customers`.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;
create schema if not exists app;

-- (Helper functions that reference tables — app.is_member, app.my_merchant —
--  are defined in 0002, after the tables exist.)

-- ─── Profiles (mirror auth.users) ───────────────────────────────────────────
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'consumer' check (role in ('consumer','brand')),
  display_name text,
  created_at timestamptz not null default now()
);

create table consumer_profiles (
  profile_id uuid primary key references profiles(id) on delete cascade,
  first_name text,
  last_name text,
  phone text,
  birthday date,
  gender text,
  address jsonb,
  updated_at timestamptz not null default now()
);

-- New auth user → profile (+ consumer profile when role=consumer).
create or replace function app.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_role text := coalesce(new.raw_user_meta_data->>'role', 'consumer');
begin
  insert into profiles (id, role, display_name)
  values (new.id, v_role, coalesce(new.raw_user_meta_data->>'display_name', new.email))
  on conflict (id) do nothing;
  if v_role = 'consumer' then
    insert into consumer_profiles (profile_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- ─── Scope catalog (Consent Engine dictionary) ──────────────────────────────
create table scopes (
  key text primary key,
  label text not null,
  category text not null check (category in ('profile','permission')),
  pii boolean not null default false,
  sort int not null default 0
);
insert into scopes (key,label,category,pii,sort) values
  ('profile:name','Full name','profile',true,1),
  ('profile:email','Email address','profile',true,2),
  ('profile:phone','Phone number','profile',true,3),
  ('profile:birthday','Birthday','profile',true,4),
  ('profile:gender','Gender','profile',true,5),
  ('profile:address','Address','profile',true,6),
  ('permission:marketing','Marketing communications','permission',false,7),
  ('permission:sms','SMS messages','permission',false,8),
  ('permission:location','Location analytics','permission',false,9),
  ('permission:analytics','Shopping analytics','permission',false,10);

-- ─── Brand (merchant) + branches + config ───────────────────────────────────
create table merchants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  category text,
  display_name text,
  logo_url text,
  primary_color text,
  post_consent_redirect_url text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table merchant_members (
  merchant_id uuid not null references merchants(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'admin',
  primary key (merchant_id, profile_id)
);

create table branches (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  name text not null,
  code text not null,
  city text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (merchant_id, code)
);

create table merchant_requested_fields (
  merchant_id uuid not null references merchants(id) on delete cascade,
  scope_key text not null references scopes(key),
  required boolean not null default false,
  primary key (merchant_id, scope_key)
);

-- Machine credentials for POS/server-to-server (verified by an Edge Function).
create table merchant_credentials (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  client_id text unique not null,
  client_secret_hash text not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

-- ─── Consent: the handshake ─────────────────────────────────────────────────
create table identity_requests (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  request_token text unique not null default encode(gen_random_bytes(18),'hex'),
  requested_scopes text[] not null,
  required_scopes text[] not null,
  status text not null default 'pending' check (status in ('pending','approved','denied','expired')),
  consumer_id uuid references profiles(id) on delete set null,
  granted_scopes text[],
  reference text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '5 minutes',
  decided_at timestamptz
);
create index on identity_requests (merchant_id);

create table consent_grants (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  consumer_id uuid not null references profiles(id) on delete cascade,
  granted_scopes text[] not null,
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (merchant_id, consumer_id)
);
create index on consent_grants (consumer_id);

-- ─── Wallet ─────────────────────────────────────────────────────────────────
create table receipts (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  consumer_id uuid not null references profiles(id) on delete cascade,
  external_id text, store_name text,
  currency text not null default 'TRY',
  total_minor int not null default 0,
  purchased_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references receipts(id) on delete cascade,
  name text not null, sku text,
  quantity int not null default 1,
  unit_price_minor int not null default 0,
  warranty_months int, return_days int
);
create table warranties (
  id uuid primary key default gen_random_uuid(),
  consumer_id uuid not null references profiles(id) on delete cascade,
  receipt_id uuid not null references receipts(id) on delete cascade,
  item_name text not null, months int not null,
  starts_at timestamptz not null, expires_at timestamptz not null
);
create table wallet_items (
  id uuid primary key default gen_random_uuid(),
  consumer_id uuid not null references profiles(id) on delete cascade,
  merchant_id uuid references merchants(id) on delete set null,
  type text not null check (type in ('gift_card','coupon','loyalty_card','membership_card')),
  title text not null, code text, balance_minor int, currency text,
  expires_at timestamptz, status text not null default 'active',
  created_at timestamptz not null default now()
);

-- ─── Engagement ─────────────────────────────────────────────────────────────
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  title text not null, body text,
  require_scope text not null default 'permission:marketing',
  targeted_count int not null default 0, delivered_count int not null default 0,
  created_at timestamptz not null default now()
);
create table memberships (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  consumer_id uuid not null references profiles(id) on delete cascade,
  tier text not null default 'standard', points int not null default 0,
  joined_at timestamptz not null default now(),
  unique (merchant_id, consumer_id)
);
create table notifications (
  id uuid primary key default gen_random_uuid(),
  consumer_id uuid not null references profiles(id) on delete cascade,
  merchant_id uuid references merchants(id) on delete set null,
  type text not null, title text not null, body text,
  dedupe_key text, read boolean not null default false,
  created_at timestamptz not null default now()
);

-- ─── Mall ───────────────────────────────────────────────────────────────────
create table malls (
  id uuid primary key default gen_random_uuid(),
  name text not null, slug text unique not null, city text,
  created_at timestamptz not null default now()
);
create table mall_stores (
  mall_id uuid not null references malls(id) on delete cascade,
  merchant_id uuid not null references merchants(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (mall_id, merchant_id)
);

-- ─── Integrations ───────────────────────────────────────────────────────────
create table connectors (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  kind text not null check (kind in ('crm','pos','erp')),
  adapter text not null default 'log',
  name text not null, config jsonb,
  active boolean not null default true, is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create table connector_sync_logs (
  id uuid primary key default gen_random_uuid(),
  connector_id uuid not null references connectors(id) on delete cascade,
  merchant_id uuid not null references merchants(id) on delete cascade,
  operation text not null, record jsonb, status text not null default 'delivered',
  created_at timestamptz not null default now()
);
create table webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  url text not null, secret text not null,
  events text[] not null default array['*'], active boolean not null default true,
  created_at timestamptz not null default now()
);
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null, actor_id uuid,
  action text not null, merchant_id uuid, consumer_id uuid,
  resource_type text, resource_id uuid, metadata jsonb,
  created_at timestamptz not null default now()
);
