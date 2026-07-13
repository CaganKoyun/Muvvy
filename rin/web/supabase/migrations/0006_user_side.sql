-- ═══════════════════════════════════════════════════════════════════════════
-- Epic 4 — User-side: notification preferences, KVKK/GDPR export & erasure,
-- memberships. The shopper owns and controls their data.
-- ═══════════════════════════════════════════════════════════════════════════

alter table consumer_profiles add column if not exists pref_marketing_email boolean not null default true;
alter table consumer_profiles add column if not exists pref_sms boolean not null default true;
alter table consumer_profiles add column if not exists pref_push boolean not null default true;

-- Everything Spark holds about me (KVKK/GDPR data-subject access).
create or replace function export_my_data()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare v_uid uuid := auth.uid(); v_email text;
begin
  select email into v_email from auth.users where id = v_uid;
  return jsonb_build_object(
    'identity', jsonb_build_object('id', v_uid, 'email', v_email),
    'profile', (select to_jsonb(cp) from consumer_profiles cp where cp.profile_id = v_uid),
    'connected_brands', (select coalesce(jsonb_agg(to_jsonb(g)),'[]') from consent_grants g where g.consumer_id = v_uid),
    'receipts', (select coalesce(jsonb_agg(to_jsonb(r)),'[]') from receipts r where r.consumer_id = v_uid),
    'warranties', (select coalesce(jsonb_agg(to_jsonb(w)),'[]') from warranties w where w.consumer_id = v_uid),
    'wallet', (select coalesce(jsonb_agg(to_jsonb(wi)),'[]') from wallet_items wi where wi.consumer_id = v_uid),
    'memberships', (select coalesce(jsonb_agg(to_jsonb(m)),'[]') from memberships m where m.consumer_id = v_uid),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(n)),'[]') from notifications n where n.consumer_id = v_uid),
    'activity', (select coalesce(jsonb_agg(to_jsonb(a)),'[]') from audit_log a where a.consumer_id = v_uid),
    'exported_at', now()
  );
end; $$;

-- Withdraw from every brand at once.
create or replace function revoke_all_consents()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_count int;
begin
  update consent_grants set status='revoked', revoked_at=now() where consumer_id = v_uid and status='active';
  get diagnostics v_count = row_count;
  insert into audit_log(actor_type,actor_id,action,consumer_id) values ('consumer',v_uid,'consent.revoked_all',v_uid);
  return jsonb_build_object('revoked', v_count);
end; $$;

-- Right to erasure (KVKK md.7 / GDPR art.17): purge every personal record Spark
-- holds about me, then clear all profile PII. The profile/consumer rows survive
-- as empty skeletons so the still-authenticated session keeps working (this is
-- "erase my data", not "delete my account"). Deleting the auth.users row itself
-- (the login e-mail) needs the Auth admin API and is out of scope for a SQL RPC.
create or replace function delete_my_data()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_purged int := 0; v_n int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- Revoke every active grant FIRST so the sync trigger notifies each connected
  -- brand's CRM to drop this customer, then delete the linkage rows outright
  -- (the audit_log keeps the legal trail; deletion also lets me re-consent clean).
  update consent_grants set status='revoked', revoked_at=now() where consumer_id = v_uid and status='active';
  delete from consent_grants where consumer_id = v_uid;   get diagnostics v_n = row_count; v_purged := v_purged + v_n;

  -- Wipe every personal record. Delete warranties before their parent receipts
  -- so each is counted once (receipts still cascades to receipt_items).
  delete from warranties    where consumer_id = v_uid;    get diagnostics v_n = row_count; v_purged := v_purged + v_n;
  delete from receipts      where consumer_id = v_uid;    get diagnostics v_n = row_count; v_purged := v_purged + v_n;
  delete from wallet_items  where consumer_id = v_uid;    get diagnostics v_n = row_count; v_purged := v_purged + v_n;
  delete from memberships   where consumer_id = v_uid;    get diagnostics v_n = row_count; v_purged := v_purged + v_n;
  delete from notifications where consumer_id = v_uid;    get diagnostics v_n = row_count; v_purged := v_purged + v_n;

  -- Clear all PII the profile carries, including the display name (seeded from
  -- the e-mail on signup) and the opt-in flags — no marketing after erasure.
  update consumer_profiles
     set first_name=null, last_name=null, phone=null, birthday=null, gender=null, address=null,
         pref_marketing_email=false, pref_sms=false, pref_push=false, updated_at=now()
   where profile_id = v_uid;
  update profiles set display_name = null where id = v_uid;

  insert into audit_log(actor_type,actor_id,action,consumer_id) values ('consumer',v_uid,'data.erased',v_uid);
  return jsonb_build_object('erased', true, 'records_purged', v_purged);
end; $$;

-- My loyalty memberships across brands.
create or replace function my_memberships()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'tier', m.tier, 'points', m.points, 'since', m.joined_at,
      'brand', jsonb_build_object('name', coalesce(mer.display_name, mer.name), 'logo_url', mer.logo_url, 'primary_color', mer.primary_color)
    ) order by m.points desc), '[]')
    from memberships m join merchants mer on mer.id = m.merchant_id where m.consumer_id = auth.uid());
end; $$;

grant execute on all functions in schema public to authenticated;
