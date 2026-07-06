-- ═══════════════════════════════════════════════════════════════════════════
-- Persist the SIGNUP branch (şube) on the durable customer grant, and surface
-- brand + branch on every customer view — so the QR owner sees, for each
-- member: which store & branch they joined at, plus the consented data.
-- ═══════════════════════════════════════════════════════════════════════════

alter table consent_grants add column if not exists branch_id uuid references branches(id) on delete set null;

-- approve_consent: carry the request's branch onto the grant (keep the first).
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

  insert into consent_grants (merchant_id, consumer_id, branch_id, granted_scopes, status)
  values (r.merchant_id, v_consumer, r.branch_id, p_granted, 'active')
  on conflict (merchant_id, consumer_id) do update
    set granted_scopes=excluded.granted_scopes, status='active', revoked_at=null, updated_at=now(),
        branch_id=coalesce(consent_grants.branch_id, excluded.branch_id)
  returning * into g;

  update identity_requests set status='approved', consumer_id=v_consumer, granted_scopes=p_granted, decided_at=now() where id=r.id;
  select * into m from merchants where id=r.merchant_id;
  insert into audit_log(actor_type,actor_id,action,merchant_id,consumer_id,resource_type,resource_id,metadata)
    values ('consumer',v_consumer,'consent.granted',r.merchant_id,v_consumer,'consent_grant',g.id,jsonb_build_object('scopes',p_granted,'branch_id',r.branch_id));
  insert into connector_sync_logs(connector_id, merchant_id, operation, record)
    select c.id, c.merchant_id, 'upsert_customer', jsonb_build_object('customerRef', g.id, 'scopes', p_granted, 'branch_id', r.branch_id)
    from connectors c where c.merchant_id = r.merchant_id and c.active;
  return jsonb_build_object('grant_id', g.id, 'status','approved',
    'brand', jsonb_build_object('name', coalesce(m.display_name,m.name), 'primary_color', m.primary_color),
    'redirect', m.post_consent_redirect_url);
end; $$;

-- Small helper: a branch as jsonb (or null).
create or replace function app.branch_json(p_branch_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when b.id is null then null else jsonb_build_object('id',b.id,'name',b.name,'code',b.code,'city',b.city) end
  from (select 1) x left join branches b on b.id = p_branch_id;
$$;

-- list_customers: include the signup branch on each member.
create or replace function list_customers()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_merchant uuid := app.my_merchant();
begin
  if v_merchant is null then raise exception 'not a brand member'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'grant_id',id,'status',status,'granted_scopes',granted_scopes,'member_since',created_at,
      'branch', app.branch_json(branch_id)) order by created_at desc),'[]')
    from consent_grants where merchant_id = v_merchant);
end; $$;

-- get_customer: include the signup branch alongside the disclosed data.
create or replace function get_customer(p_grant_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g consent_grants;
begin
  select * into g from consent_grants where id = p_grant_id;
  if g.id is null or not app.is_member(g.merchant_id) then raise exception 'not found'; end if;
  if g.status <> 'active' then return jsonb_build_object('grant_id',g.id,'status','revoked','branch',app.branch_json(g.branch_id)); end if;
  return jsonb_build_object('grant_id',g.id,'status','active','granted_scopes',g.granted_scopes,
    'branch', app.branch_json(g.branch_id),
    'customer', app.resolve_disclosure(g.consumer_id, g.granted_scopes));
end; $$;

-- get_request_result: include the branch on the approved result too.
create or replace function get_request_result(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r identity_requests; g consent_grants;
begin
  select * into r from identity_requests where id = p_request_id;
  if r.id is null or not app.is_member(r.merchant_id) then raise exception 'not found'; end if;
  if r.status <> 'approved' or r.consumer_id is null then
    return jsonb_build_object('request_id', r.id, 'status', r.status, 'branch', app.branch_json(r.branch_id));
  end if;
  select * into g from consent_grants where merchant_id = r.merchant_id and consumer_id = r.consumer_id;
  if g.id is null or g.status <> 'active' then
    return jsonb_build_object('request_id', r.id, 'status', 'revoked');
  end if;
  return jsonb_build_object('request_id', r.id, 'status', 'approved', 'grant_id', g.id,
    'branch', app.branch_json(r.branch_id),
    'granted_scopes', g.granted_scopes, 'customer', app.resolve_disclosure(g.consumer_id, g.granted_scopes));
end; $$;

grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema app to authenticated;
