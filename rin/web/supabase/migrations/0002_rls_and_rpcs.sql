-- ═══════════════════════════════════════════════════════════════════════════
-- RLS policies + SECURITY DEFINER RPCs (the consent handshake logic)
-- ═══════════════════════════════════════════════════════════════════════════

-- Brand-staff membership check (used by RLS and RPCs).
create or replace function app.is_member(p_merchant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from merchant_members where merchant_id = p_merchant and profile_id = auth.uid()
  );
$$;

-- The current brand-staff user's merchant (first membership).
create or replace function app.my_merchant()
returns uuid language sql stable security definer set search_path = public as $$
  select merchant_id from merchant_members where profile_id = auth.uid() limit 1;
$$;

-- ─── Enable + FORCE RLS everywhere ──────────────────────────────────────────
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);
  end loop;
end $$;

-- ─── Policies: public / consumer-owned reads ────────────────────────────────
create policy scopes_read on scopes for select using (true);

create policy profiles_self on profiles for select using (id = auth.uid());
create policy cprofiles_self on consumer_profiles for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy grants_consumer_sel on consent_grants for select using (consumer_id = auth.uid());
create policy grants_consumer_upd on consent_grants for update using (consumer_id = auth.uid());

create policy notif_consumer on notifications for all using (consumer_id = auth.uid()) with check (consumer_id = auth.uid());
create policy receipts_consumer on receipts for select using (consumer_id = auth.uid());
create policy ritems_consumer on receipt_items for select using (exists (select 1 from receipts r where r.id = receipt_id and r.consumer_id = auth.uid()));
create policy warr_consumer on warranties for select using (consumer_id = auth.uid());
create policy wallet_consumer on wallet_items for select using (consumer_id = auth.uid());
create policy mem_consumer on memberships for select using (consumer_id = auth.uid());
create policy audit_consumer on audit_log for select using (consumer_id = auth.uid());

-- ─── Policies: brand-member reads/writes ────────────────────────────────────
create policy merchants_member on merchants for select using (app.is_member(id));
create policy merchants_upd on merchants for update using (app.is_member(id));
create policy members_self on merchant_members for select using (profile_id = auth.uid());
create policy branches_member on branches for all using (app.is_member(merchant_id)) with check (app.is_member(merchant_id));
create policy reqfields_member on merchant_requested_fields for all using (app.is_member(merchant_id)) with check (app.is_member(merchant_id));
create policy creds_member on merchant_credentials for select using (app.is_member(merchant_id));
create policy campaigns_member on campaigns for select using (app.is_member(merchant_id));
create policy connectors_member on connectors for all using (app.is_member(merchant_id)) with check (app.is_member(merchant_id));
create policy synclog_member on connector_sync_logs for select using (app.is_member(merchant_id));
create policy hooks_member on webhook_endpoints for all using (app.is_member(merchant_id)) with check (app.is_member(merchant_id));
create policy mem_brand on memberships for select using (app.is_member(merchant_id));

-- Malls readable by any authenticated user (mall dashboard is RPC-gated).
create policy malls_read on malls for select using (auth.role() = 'authenticated');
create policy mallstores_read on mall_stores for select using (auth.role() = 'authenticated');

-- identity_requests + consent_grants(brand side) + customer disclosure → RPC only.

-- ─── Disclosure resolver (the privacy boundary) ─────────────────────────────
create or replace function app.resolve_disclosure(p_consumer uuid, p_scopes text[])
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare cp consumer_profiles; v_email text; prof jsonb := '{}'::jsonb; perm jsonb := '{}'::jsonb;
begin
  select * into cp from consumer_profiles where profile_id = p_consumer;
  select email into v_email from auth.users where id = p_consumer;
  if 'profile:name' = any(p_scopes) then prof := prof || jsonb_build_object('name', nullif(trim(coalesce(cp.first_name,'')||' '||coalesce(cp.last_name,'')),'')); end if;
  if 'profile:email' = any(p_scopes) then prof := prof || jsonb_build_object('email', v_email); end if;
  if 'profile:phone' = any(p_scopes) then prof := prof || jsonb_build_object('phone', cp.phone); end if;
  if 'profile:birthday' = any(p_scopes) then prof := prof || jsonb_build_object('birthday', cp.birthday); end if;
  if 'profile:gender' = any(p_scopes) then prof := prof || jsonb_build_object('gender', cp.gender); end if;
  if 'profile:address' = any(p_scopes) then prof := prof || jsonb_build_object('address', cp.address); end if;
  if 'permission:marketing' = any(p_scopes) then perm := perm || jsonb_build_object('marketing', true); end if;
  if 'permission:sms' = any(p_scopes) then perm := perm || jsonb_build_object('sms', true); end if;
  if 'permission:location' = any(p_scopes) then perm := perm || jsonb_build_object('location', true); end if;
  if 'permission:analytics' = any(p_scopes) then perm := perm || jsonb_build_object('analytics', true); end if;
  return jsonb_build_object('profile', prof, 'permissions', perm);
end; $$;

-- ─── Brand: create a branded identity request (the QR) ──────────────────────
create or replace function create_identity_request(p_branch_id uuid default null, p_reference text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_merchant uuid := app.my_merchant(); v_req identity_requests; v_scopes text[]; v_required text[];
begin
  if v_merchant is null then raise exception 'not a brand member'; end if;
  if p_branch_id is not null and not exists (select 1 from branches where id=p_branch_id and merchant_id=v_merchant)
    then raise exception 'branch not found'; end if;
  select coalesce(array_agg(scope_key),'{}') into v_scopes from merchant_requested_fields where merchant_id=v_merchant;
  select coalesce(array_agg(scope_key),'{}') into v_required from merchant_requested_fields where merchant_id=v_merchant and required;
  if array_length(v_scopes,1) is null then raise exception 'no consent config'; end if;
  insert into identity_requests (merchant_id, branch_id, requested_scopes, required_scopes, reference)
  values (v_merchant, p_branch_id, v_scopes, v_required, p_reference) returning * into v_req;
  return jsonb_build_object('request_id', v_req.id, 'request_token', v_req.request_token,
    'branch_id', v_req.branch_id, 'requested_scopes', v_req.requested_scopes,
    'required_scopes', v_req.required_scopes, 'status', v_req.status, 'expires_at', v_req.expires_at);
end; $$;

-- ─── Consumer: view a request (branded consent screen data) ─────────────────
create or replace function get_consent_request(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r identity_requests; m merchants; b branches;
begin
  select * into r from identity_requests where request_token = p_token;
  if r.id is null then raise exception 'request not found'; end if;
  if r.status='pending' and r.expires_at < now() then update identity_requests set status='expired' where id=r.id; r.status:='expired'; end if;
  select * into m from merchants where id = r.merchant_id;
  if r.branch_id is not null then select * into b from branches where id = r.branch_id; end if;
  return jsonb_build_object(
    'request_id', r.id, 'status', r.status,
    'brand', jsonb_build_object('name', coalesce(m.display_name,m.name), 'slug', m.slug, 'logo_url', m.logo_url, 'primary_color', m.primary_color),
    'branch', case when b.id is not null then jsonb_build_object('id',b.id,'name',b.name,'code',b.code,'city',b.city) else null end,
    'requested', (select coalesce(jsonb_agg(jsonb_build_object('key',s.key,'label',s.label,'category',s.category,'pii',s.pii) order by s.sort),'[]') from scopes s where s.key = any(r.requested_scopes)),
    'required_scopes', r.required_scopes, 'expires_at', r.expires_at);
end; $$;

-- ─── Consumer: approve with granular scopes ─────────────────────────────────
create or replace function approve_consent(p_token text, p_granted text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare r identity_requests; m merchants; v_consumer uuid := auth.uid(); g consent_grants; extra text[]; missing text[];
begin
  select * into r from identity_requests where request_token = p_token;
  if r.id is null then raise exception 'request not found'; end if;
  if r.status='pending' and r.expires_at < now() then update identity_requests set status='expired' where id=r.id; raise exception 'request expired'; end if;
  if r.status <> 'pending' then raise exception 'request already %', r.status; end if;
  select array(select unnest(p_granted) except select unnest(r.requested_scopes)) into extra;
  if array_length(extra,1) > 0 then raise exception 'scopes not requested: %', extra; end if;
  select array(select unnest(r.required_scopes) except select unnest(p_granted)) into missing;
  if array_length(missing,1) > 0 then raise exception 'required scopes missing: %', missing; end if;

  insert into consent_grants (merchant_id, consumer_id, granted_scopes, status)
  values (r.merchant_id, v_consumer, p_granted, 'active')
  on conflict (merchant_id, consumer_id) do update set granted_scopes=excluded.granted_scopes, status='active', revoked_at=null, updated_at=now()
  returning * into g;

  update identity_requests set status='approved', consumer_id=v_consumer, granted_scopes=p_granted, decided_at=now() where id=r.id;
  select * into m from merchants where id=r.merchant_id;
  insert into audit_log(actor_type,actor_id,action,merchant_id,consumer_id,resource_type,resource_id,metadata)
    values ('consumer',v_consumer,'consent.granted',r.merchant_id,v_consumer,'consent_grant',g.id,jsonb_build_object('scopes',p_granted));
  -- Route into the brand's connectors (Integration Gateway).
  insert into connector_sync_logs(connector_id, merchant_id, operation, record)
    select c.id, c.merchant_id, 'upsert_customer', jsonb_build_object('customerRef', g.id, 'scopes', p_granted)
    from connectors c where c.merchant_id = r.merchant_id and c.active;
  return jsonb_build_object('grant_id', g.id, 'status','approved',
    'brand', jsonb_build_object('name', coalesce(m.display_name,m.name), 'primary_color', m.primary_color),
    'redirect', m.post_consent_redirect_url);
end; $$;

create or replace function deny_consent(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r identity_requests;
begin
  update identity_requests set status='denied', consumer_id=auth.uid(), decided_at=now()
    where request_token=p_token and status='pending' returning * into r;
  return jsonb_build_object('status', coalesce(r.status,'not_pending'));
end; $$;

create or replace function revoke_grant(p_grant_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g consent_grants;
begin
  update consent_grants set status='revoked', revoked_at=now()
    where id=p_grant_id and consumer_id=auth.uid() and status='active' returning * into g;
  if g.id is null then return jsonb_build_object('status','not_found'); end if;
  insert into audit_log(actor_type,actor_id,action,merchant_id,consumer_id,resource_type,resource_id)
    values ('consumer',auth.uid(),'consent.revoked',g.merchant_id,auth.uid(),'consent_grant',g.id);
  return jsonb_build_object('grant_id', g.id, 'status','revoked');
end; $$;

-- ─── Brand: read consented customers (NO consumer_id disclosed) ──────────────
create or replace function get_customer(p_grant_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g consent_grants;
begin
  select * into g from consent_grants where id = p_grant_id;
  if g.id is null or not app.is_member(g.merchant_id) then raise exception 'not found'; end if;
  if g.status <> 'active' then return jsonb_build_object('grant_id',g.id,'status','revoked'); end if;
  return jsonb_build_object('grant_id',g.id,'status','active','granted_scopes',g.granted_scopes,
    'customer', app.resolve_disclosure(g.consumer_id, g.granted_scopes));
end; $$;

create or replace function list_customers()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_merchant uuid := app.my_merchant();
begin
  if v_merchant is null then raise exception 'not a brand member'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('grant_id',id,'status',status,'granted_scopes',granted_scopes,'member_since',created_at) order by created_at desc),'[]')
    from consent_grants where merchant_id = v_merchant);
end; $$;

create or replace function merchant_dashboard()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_merchant uuid := app.my_merchant(); v_all int; v_appr int; v_den int; v_active int; v_avg numeric;
begin
  if v_merchant is null then raise exception 'not a brand member'; end if;
  select count(*) into v_all from identity_requests where merchant_id=v_merchant;
  select count(*) into v_appr from identity_requests where merchant_id=v_merchant and status='approved';
  select count(*) into v_den from identity_requests where merchant_id=v_merchant and status='denied';
  select count(*) into v_active from consent_grants where merchant_id=v_merchant and status='active';
  select round(avg(extract(epoch from (decided_at-created_at)))::numeric,2) into v_avg from identity_requests where merchant_id=v_merchant and status='approved' and decided_at is not null;
  return jsonb_build_object('newMembers',v_active,'activeGrants',v_active,'totalRequests',v_all,
    'approvedRequests',v_appr,'deniedRequests',v_den,
    'consentRate', case when (v_appr+v_den)>0 then round(v_appr::numeric/(v_appr+v_den),3) else 0 end,
    'avgCheckoutSeconds', v_avg);
end; $$;

-- ─── Brand: upload receipt (only to a consented customer) ───────────────────
create or replace function upload_receipt(p_grant_id uuid, p_store text, p_purchased_at timestamptz, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g consent_grants; v_receipt receipts; it jsonb; v_total int := 0;
begin
  select * into g from consent_grants where id=p_grant_id and status='active';
  if g.id is null or not app.is_member(g.merchant_id) then raise exception 'no active grant'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_total := v_total + coalesce((it->>'unitPriceMinor')::int,0) * coalesce((it->>'quantity')::int,1);
  end loop;
  insert into receipts(merchant_id,consumer_id,store_name,total_minor,purchased_at)
    values (g.merchant_id,g.consumer_id,p_store,v_total,coalesce(p_purchased_at,now())) returning * into v_receipt;
  for it in select * from jsonb_array_elements(p_items) loop
    insert into receipt_items(receipt_id,name,quantity,unit_price_minor,warranty_months,return_days)
      values (v_receipt.id, it->>'name', coalesce((it->>'quantity')::int,1), coalesce((it->>'unitPriceMinor')::int,0),
        (it->>'warrantyMonths')::int, (it->>'returnDays')::int);
    if (it->>'warrantyMonths') is not null then
      insert into warranties(consumer_id,receipt_id,item_name,months,starts_at,expires_at)
        values (g.consumer_id, v_receipt.id, it->>'name', (it->>'warrantyMonths')::int,
          coalesce(p_purchased_at,now()), coalesce(p_purchased_at,now()) + ((it->>'warrantyMonths')::int || ' months')::interval);
    end if;
  end loop;
  return jsonb_build_object('receipt_id', v_receipt.id, 'total_minor', v_total);
end; $$;

-- ─── Brand: consent-safe campaign ───────────────────────────────────────────
create or replace function send_campaign(p_title text, p_body text default null, p_require_scope text default 'permission:marketing')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_merchant uuid := app.my_merchant(); v_camp campaigns; v_total int; v_targeted int; v_delivered int := 0; g record;
begin
  if v_merchant is null then raise exception 'not a brand member'; end if;
  select count(*) into v_total from consent_grants where merchant_id=v_merchant and status='active';
  insert into campaigns(merchant_id,title,body,require_scope) values (v_merchant,p_title,p_body,p_require_scope) returning * into v_camp;
  for g in select * from consent_grants where merchant_id=v_merchant and status='active' and p_require_scope = any(granted_scopes) loop
    insert into notifications(consumer_id,merchant_id,type,title,body) values (g.consumer_id,v_merchant,'campaign',p_title,p_body);
    v_delivered := v_delivered + 1;
  end loop;
  v_targeted := v_delivered;
  update campaigns set targeted_count=v_targeted, delivered_count=v_delivered where id=v_camp.id;
  return jsonb_build_object('campaign_id',v_camp.id,'totalMembers',v_total,'targeted',v_targeted,'delivered',v_delivered,'suppressed',v_total-v_targeted);
end; $$;

-- ─── Brand: set primary connector ───────────────────────────────────────────
create or replace function set_primary_connector(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c connectors;
begin
  select * into c from connectors where id=p_id;
  if c.id is null or not app.is_member(c.merchant_id) then raise exception 'not found'; end if;
  update connectors set is_primary=false where merchant_id=c.merchant_id;
  update connectors set is_primary=true where id=p_id;
  return jsonb_build_object('ok',true,'primary',p_id);
end; $$;

-- ─── Consumer: connected brands (with branding) ─────────────────────────────
create or replace function my_connected_brands()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'grant_id', g.id, 'status', g.status, 'granted_scopes', g.granted_scopes,
      'brand', jsonb_build_object('name', coalesce(m.display_name,m.name), 'slug', m.slug, 'logo_url', m.logo_url, 'primary_color', m.primary_color)
    ) order by g.updated_at desc), '[]')
    from consent_grants g join merchants m on m.id=g.merchant_id where g.consumer_id = auth.uid());
end; $$;

-- ─── Grants ─────────────────────────────────────────────────────────────────
grant usage on schema app to authenticated, anon;
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema app to authenticated;
