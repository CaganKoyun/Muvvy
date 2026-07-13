-- ═══════════════════════════════════════════════════════════════════════════
-- Additional SECURITY DEFINER RPCs used by the dashboard/app.
-- ═══════════════════════════════════════════════════════════════════════════

-- Brand: poll a request; when approved, return the consented customer.
create or replace function get_request_result(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r identity_requests; g consent_grants;
begin
  select * into r from identity_requests where id = p_request_id;
  if r.id is null or not app.is_member(r.merchant_id) then raise exception 'not found'; end if;
  if r.status <> 'approved' or r.consumer_id is null then
    return jsonb_build_object('request_id', r.id, 'status', r.status);
  end if;
  select * into g from consent_grants where merchant_id = r.merchant_id and consumer_id = r.consumer_id;
  if g.id is null or g.status <> 'active' then
    return jsonb_build_object('request_id', r.id, 'status', 'revoked');
  end if;
  return jsonb_build_object('request_id', r.id, 'status', 'approved', 'grant_id', g.id,
    'granted_scopes', g.granted_scopes, 'customer', app.resolve_disclosure(g.consumer_id, g.granted_scopes));
end; $$;

-- Brand: issue a coupon / gift card / loyalty card to a consented customer.
create or replace function issue_wallet_item(p_grant_id uuid, p_type text, p_title text, p_code text default null,
  p_balance_minor int default null, p_currency text default null, p_expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g consent_grants; w wallet_items;
begin
  select * into g from consent_grants where id = p_grant_id and status = 'active';
  if g.id is null or not app.is_member(g.merchant_id) then raise exception 'no active grant'; end if;
  insert into wallet_items(consumer_id, merchant_id, type, title, code, balance_minor, currency, expires_at)
    values (g.consumer_id, g.merchant_id, p_type, p_title, p_code, p_balance_minor, p_currency, p_expires_at)
    returning * into w;
  return jsonb_build_object('wallet_item_id', w.id, 'type', w.type);
end; $$;

-- Brand: create/update a membership (tier, points) for a customer.
create or replace function upsert_membership(p_grant_id uuid, p_tier text default null, p_add_points int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g consent_grants; m memberships;
begin
  select * into g from consent_grants where id = p_grant_id and status = 'active';
  if g.id is null or not app.is_member(g.merchant_id) then raise exception 'no active grant'; end if;
  insert into memberships(merchant_id, consumer_id, tier, points)
    values (g.merchant_id, g.consumer_id, coalesce(p_tier,'standard'), coalesce(p_add_points,0))
    on conflict (merchant_id, consumer_id) do update
      set tier = coalesce(p_tier, memberships.tier), points = memberships.points + coalesce(p_add_points,0)
    returning * into m;
  return jsonb_build_object('membership_id', m.id, 'tier', m.tier, 'points', m.points);
end; $$;

-- Mall: identity dashboard across member stores (member-of-a-store gated).
create or replace function mall_dashboard(p_mall_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ok boolean; v_stores int; v_identified int; v_total int;
begin
  select exists (
    select 1 from mall_stores ms join merchant_members mm on mm.merchant_id = ms.merchant_id
    where ms.mall_id = p_mall_id and mm.profile_id = auth.uid()
  ) into v_ok;
  if not v_ok then raise exception 'not a member of this mall'; end if;
  select count(*) into v_stores from mall_stores where mall_id = p_mall_id;
  select count(distinct g.consumer_id), count(*) into v_identified, v_total
    from consent_grants g join mall_stores ms on ms.merchant_id = g.merchant_id
    where ms.mall_id = p_mall_id and g.status = 'active';
  return jsonb_build_object('storeParticipation', v_stores, 'identifiedShoppers', coalesce(v_identified,0),
    'totalStoreMemberships', coalesce(v_total,0), 'crossStoreShoppers', coalesce(v_total,0) - coalesce(v_identified,0));
end; $$;

grant execute on all functions in schema public to authenticated;
