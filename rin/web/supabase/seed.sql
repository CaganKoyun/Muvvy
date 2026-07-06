-- Seed for `supabase db reset`. Creates a brand admin + a shopper (both real
-- auth users), the LC Waikiki brand with branding, a branch, the Consent Engine
-- config, a primary connector, and a mall. Passwords: "password123".

-- Brand admin + shopper (auth.users). Fixed ids for determinism.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111','authenticated','authenticated','owner@lcwaikiki.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"role":"brand","display_name":"LCW Admin"}'),
  ('00000000-0000-0000-0000-000000000000','22222222-2222-2222-2222-222222222222','authenticated','authenticated','ahmet@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"role":"consumer","display_name":"Ahmet"}')
on conflict (id) do nothing;

update consumer_profiles set first_name='Ahmet', last_name='Yılmaz', phone='+905551112233', gender='male', birthday='1990-05-14'
  where profile_id='22222222-2222-2222-2222-222222222222';

insert into merchants (id,name,slug,category,display_name,logo_url,primary_color,post_consent_redirect_url)
values ('33333333-3333-3333-3333-333333333333','LC Waikiki','lc-waikiki','fashion','LC Waikiki','https://logo.clearbit.com/lcwaikiki.com','#0057B8','https://app.lcwaikiki.com/welcome')
on conflict (id) do nothing;

insert into merchant_members (merchant_id, profile_id) values
  ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111') on conflict do nothing;

insert into branches (id,merchant_id,name,code,city) values
  ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333','LC Waikiki Akasya','AKASYA','İstanbul') on conflict do nothing;

insert into merchant_requested_fields (merchant_id,scope_key,required) values
  ('33333333-3333-3333-3333-333333333333','profile:email',true),
  ('33333333-3333-3333-3333-333333333333','profile:phone',true),
  ('33333333-3333-3333-3333-333333333333','permission:marketing',true),
  ('33333333-3333-3333-3333-333333333333','profile:birthday',false),
  ('33333333-3333-3333-3333-333333333333','profile:gender',false),
  ('33333333-3333-3333-3333-333333333333','profile:address',false)
on conflict do nothing;

insert into connectors (merchant_id,kind,adapter,name,config,is_primary) values
  ('33333333-3333-3333-3333-333333333333','crm','log','Salesforce','{"apiKey":"demo"}',true) on conflict do nothing;

-- Machine API key for POS integration (Edge Function `pos-request`).
-- client_id: spark_client_demo  ·  client_secret: secret_demo  (sha256 stored)
insert into merchant_credentials (merchant_id, client_id, client_secret_hash) values
  ('33333333-3333-3333-3333-333333333333','spark_client_demo', encode(digest('secret_demo','sha256'),'hex')) on conflict do nothing;

insert into malls (id,name,slug,city) values ('55555555-5555-5555-5555-555555555555','Akasya AVM','akasya','İstanbul') on conflict do nothing;
insert into mall_stores (mall_id,merchant_id) values ('55555555-5555-5555-5555-555555555555','33333333-3333-3333-3333-333333333333') on conflict do nothing;
