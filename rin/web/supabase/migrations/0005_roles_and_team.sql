-- ═══════════════════════════════════════════════════════════════════════════
-- Epic 1 — Roles & branch-level access, team invites, brand self-signup.
-- Roles: owner > admin > branch_manager > staff. Sensitive actions (branding,
-- integrations, consent config, invites, plan) are admin+; branch_manager is
-- scoped to their branch for the customer view.
-- ═══════════════════════════════════════════════════════════════════════════

alter table merchant_members add column if not exists branch_id uuid references branches(id) on delete set null;
alter table merchant_members add column if not exists created_at timestamptz not null default now();
do $$ begin
  alter table merchant_members drop constraint if exists merchant_members_role_check;
  alter table merchant_members add constraint merchant_members_role_check
    check (role in ('owner','admin','branch_manager','staff'));
end $$;

create table if not exists merchant_invites (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  email text not null,
  role text not null default 'staff' check (role in ('admin','branch_manager','staff')),
  branch_id uuid references branches(id) on delete set null,
  token text unique not null default encode(gen_random_bytes(12),'hex'),
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table merchant_invites enable row level security;
alter table merchant_invites force row level security;

-- ─── Role helpers ───────────────────────────────────────────────────────────
create or replace function app.member_role(p_merchant uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from merchant_members where merchant_id = p_merchant and profile_id = auth.uid();
$$;
create or replace function app.is_admin(p_merchant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select app.member_role(p_merchant) in ('owner','admin');
$$;
create or replace function app.my_branch()
returns uuid language sql stable security definer set search_path = public as $$
  select branch_id from merchant_members where profile_id = auth.uid() limit 1;
$$;

-- ─── Tighten sensitive policies to admins ───────────────────────────────────
drop policy if exists merchants_upd on merchants;
create policy merchants_upd on merchants for update using (app.is_admin(id));
drop policy if exists connectors_member on connectors;
create policy connectors_admin on connectors for all using (app.is_admin(merchant_id)) with check (app.is_admin(merchant_id));
drop policy if exists reqfields_member on merchant_requested_fields;
create policy reqfields_admin on merchant_requested_fields for all using (app.is_admin(merchant_id)) with check (app.is_admin(merchant_id));
drop policy if exists hooks_member on webhook_endpoints;
create policy hooks_admin on webhook_endpoints for all using (app.is_admin(merchant_id)) with check (app.is_admin(merchant_id));
-- Any member can see the team; writes go through RPCs.
drop policy if exists members_self on merchant_members;
create policy members_team on merchant_members for select using (app.is_member(merchant_id));
create policy invites_admin on merchant_invites for select using (app.is_admin(merchant_id));

-- ─── Brand self-signup: create an org + owner membership ─────────────────────
create or replace function create_brand(p_name text, p_slug text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from merchant_members where profile_id = v_uid) then raise exception 'already belongs to a brand'; end if;
  insert into merchants(name, slug, display_name) values (p_name, p_slug, p_name) returning id into v_id;
  insert into merchant_members(merchant_id, profile_id, role) values (v_id, v_uid, 'owner');
  update profiles set role = 'brand' where id = v_uid;
  return jsonb_build_object('merchant_id', v_id);
end; $$;

-- ─── Team management (admin) ────────────────────────────────────────────────
create or replace function team_members()
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_merchant uuid := app.my_merchant();
begin
  if v_merchant is null or not app.is_member(v_merchant) then raise exception 'not a member'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'profile_id', mm.profile_id, 'role', mm.role, 'branch_id', mm.branch_id,
      'email', u.email, 'name', p.display_name, 'since', mm.created_at) order by mm.created_at), '[]')
    from merchant_members mm
    join auth.users u on u.id = mm.profile_id
    left join profiles p on p.id = mm.profile_id
    where mm.merchant_id = v_merchant);
end; $$;

create or replace function create_invite(p_email text, p_role text default 'staff', p_branch_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_merchant uuid := app.my_merchant(); inv merchant_invites;
begin
  if not app.is_admin(v_merchant) then raise exception 'admins only'; end if;
  insert into merchant_invites(merchant_id, email, role, branch_id, created_by)
    values (v_merchant, lower(p_email), p_role, p_branch_id, auth.uid()) returning * into inv;
  return jsonb_build_object('invite_id', inv.id, 'token', inv.token, 'email', inv.email, 'role', inv.role);
end; $$;

create or replace function list_invites()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_merchant uuid := app.my_merchant();
begin
  if not app.is_admin(v_merchant) then raise exception 'admins only'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email,'role',role,'status',status,'token',token) order by created_at desc),'[]')
    from merchant_invites where merchant_id = v_merchant and status = 'pending');
end; $$;

create or replace function revoke_invite(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_merchant uuid := app.my_merchant();
begin
  if not app.is_admin(v_merchant) then raise exception 'admins only'; end if;
  update merchant_invites set status='revoked' where id=p_id and merchant_id=v_merchant;
  return jsonb_build_object('ok', true);
end; $$;

-- The invited user accepts (matched by their email).
create or replace function accept_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare inv merchant_invites; v_email text;
begin
  select email into v_email from auth.users where id = auth.uid();
  select * into inv from merchant_invites where token = p_token and status = 'pending';
  if inv.id is null then raise exception 'invite not found'; end if;
  if lower(inv.email) <> lower(v_email) then raise exception 'invite is for a different email'; end if;
  insert into merchant_members(merchant_id, profile_id, role, branch_id)
    values (inv.merchant_id, auth.uid(), inv.role, inv.branch_id)
    on conflict (merchant_id, profile_id) do update set role = excluded.role, branch_id = excluded.branch_id;
  update merchant_invites set status='accepted' where id = inv.id;
  update profiles set role='brand' where id = auth.uid();
  return jsonb_build_object('merchant_id', inv.merchant_id, 'role', inv.role);
end; $$;

create or replace function update_member(p_profile_id uuid, p_role text, p_branch_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_merchant uuid := app.my_merchant();
begin
  if not app.is_admin(v_merchant) then raise exception 'admins only'; end if;
  if (select role from merchant_members where merchant_id=v_merchant and profile_id=p_profile_id) = 'owner' then
    raise exception 'cannot change the owner'; end if;
  update merchant_members set role=p_role, branch_id=p_branch_id where merchant_id=v_merchant and profile_id=p_profile_id;
  return jsonb_build_object('ok', true);
end; $$;

create or replace function remove_member(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_merchant uuid := app.my_merchant();
begin
  if not app.is_admin(v_merchant) then raise exception 'admins only'; end if;
  if p_profile_id = auth.uid() then raise exception 'cannot remove yourself'; end if;
  if (select role from merchant_members where merchant_id=v_merchant and profile_id=p_profile_id) = 'owner' then
    raise exception 'cannot remove the owner'; end if;
  delete from merchant_members where merchant_id=v_merchant and profile_id=p_profile_id;
  return jsonb_build_object('ok', true);
end; $$;

-- ─── Branch-scoped customers (branch_manager sees only their branch) ─────────
create or replace function list_customers()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_merchant uuid := app.my_merchant(); v_role text; v_branch uuid;
begin
  if v_merchant is null then raise exception 'not a brand member'; end if;
  v_role := app.member_role(v_merchant);
  v_branch := app.my_branch();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'grant_id',id,'status',status,'granted_scopes',granted_scopes,'member_since',created_at,
      'branch', app.branch_json(branch_id)) order by created_at desc),'[]')
    from consent_grants
    where merchant_id = v_merchant
      and (v_role <> 'branch_manager' or v_branch is null or branch_id = v_branch));
end; $$;

-- Whoami: role + branch for the dashboard to gate its UI.
create or replace function my_membership()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_merchant uuid := app.my_merchant();
begin
  if v_merchant is null then return jsonb_build_object('role', null); end if;
  return jsonb_build_object('merchant_id', v_merchant, 'role', app.member_role(v_merchant), 'branch_id', app.my_branch());
end; $$;

grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema app to authenticated;
