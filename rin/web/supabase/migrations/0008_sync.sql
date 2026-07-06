-- ═══════════════════════════════════════════════════════════════════════════
-- Epic 3 — Automatic data sync. When a consent grant changes, a normalized
-- (field-mapped) record is ENQUEUED for each active connector; an Edge Function
-- (`process-syncs`) delivers pending rows to the brand's CRM/POS and marks
-- delivered/failed, with retry.
-- ═══════════════════════════════════════════════════════════════════════════

alter table connector_sync_logs add column if not exists attempts int not null default 0;
alter table connector_sync_logs add column if not exists last_error text;
alter table connector_sync_logs alter column status set default 'pending';

-- Rename Spark fields to the brand's CRM fields per connector.config.mapping,
-- e.g. {"profile.email":"Email","profile.phone":"MobilePhone"}.
create or replace function app.apply_mapping(p_record jsonb, p_mapping jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare result jsonb := '{}'::jsonb; k text; v text;
begin
  if p_mapping is null or p_mapping = '{}'::jsonb then return p_record; end if;
  for k, v in select * from jsonb_each_text(p_mapping) loop
    result := result || jsonb_build_object(v, p_record #> string_to_array(k, '.'));
  end loop;
  return result;
end; $$;

-- Enqueue a sync row per active connector whenever a grant changes.
create or replace function app.enqueue_syncs()
returns trigger language plpgsql security definer set search_path = public as $$
declare rec jsonb;
begin
  if NEW.status = 'active' then
    rec := jsonb_build_object('customerRef', NEW.id, 'branch_id', NEW.branch_id)
           || app.resolve_disclosure(NEW.consumer_id, NEW.granted_scopes);
    insert into connector_sync_logs(connector_id, merchant_id, operation, record, status)
      select c.id, c.merchant_id, 'upsert_customer', app.apply_mapping(rec, c.config->'mapping'), 'pending'
      from connectors c where c.merchant_id = NEW.merchant_id and c.active;
  elsif NEW.status = 'revoked' then
    insert into connector_sync_logs(connector_id, merchant_id, operation, record, status)
      select c.id, c.merchant_id, 'consent_revoked', jsonb_build_object('customerRef', NEW.id), 'pending'
      from connectors c where c.merchant_id = NEW.merchant_id and c.active;
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_enqueue_syncs on consent_grants;
create trigger trg_enqueue_syncs after insert or update of status, granted_scopes on consent_grants
  for each row execute function app.enqueue_syncs();

-- approve_consent no longer inserts sync rows inline (the trigger owns it).
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
  return jsonb_build_object('grant_id', g.id, 'status','approved',
    'brand', jsonb_build_object('name', coalesce(m.display_name,m.name), 'primary_color', m.primary_color),
    'redirect', m.post_consent_redirect_url);
end; $$;

-- Configure a connector's field mapping (admin).
create or replace function set_connector_mapping(p_id uuid, p_mapping jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c connectors;
begin
  select * into c from connectors where id = p_id;
  if c.id is null or not app.is_admin(c.merchant_id) then raise exception 'not found'; end if;
  update connectors set config = coalesce(config,'{}'::jsonb) || jsonb_build_object('mapping', p_mapping) where id = p_id;
  return jsonb_build_object('ok', true);
end; $$;

-- Re-queue a failed delivery (admin).
create or replace function retry_sync(p_log_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l connector_sync_logs;
begin
  select * into l from connector_sync_logs where id = p_log_id;
  if l.id is null or not app.is_admin(l.merchant_id) then raise exception 'not found'; end if;
  update connector_sync_logs set status='pending', last_error=null where id = p_log_id;
  return jsonb_build_object('ok', true);
end; $$;

grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema app to authenticated;
