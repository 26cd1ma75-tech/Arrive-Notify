-- =====================================================================================
-- Arrive Notify: Add People with a QR code
-- Run this ONCE in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Adds 2 tables (qr_invites, user_connections) and 7 functions (6 callable by the app + 1 internal check). No existing table is changed.
--
-- How it works
--   * Each user has a QR code that holds only a random 64-character token (never a name, email or id).
--   * Scanning calls the server, which checks the token is real, active, not expired and not your own,
--     then connects the two people. Connections are mutual and instant, because the owner chose to show
--     the code and the scanner chose to scan it. Nothing is shared by connecting: anything that notifies
--     someone or shares a location still needs their acceptance (group invitation / emergency request).
--   * The app can never write to these tables directly. Only the functions below can (row level security).
-- =====================================================================================

-- ---------- 1. Tables ----------
create table if not exists public.qr_invites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null unique check (token ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  is_active boolean not null default true
);
create index if not exists qr_invites_user_active_idx on public.qr_invites (user_id) where is_active;

create table if not exists public.user_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connected_user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'accepted' check (status in ('accepted', 'pending')),
  source text not null default 'qr',
  created_at timestamptz not null default now(),
  constraint user_connections_not_self check (user_id <> connected_user_id),
  constraint user_connections_unique_pair unique (user_id, connected_user_id)
);
create index if not exists user_connections_user_idx on public.user_connections (user_id);

-- ---------- 2. Row level security: users can only READ their own rows; all writes go through the functions ----------
alter table public.qr_invites enable row level security;
alter table public.user_connections enable row level security;

drop policy if exists qr_invites_select_own on public.qr_invites;
create policy qr_invites_select_own on public.qr_invites for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists user_connections_select_own on public.user_connections;
create policy user_connections_select_own on public.user_connections for select to authenticated
  using (user_id = (select auth.uid()));

-- (no insert / update / delete policies on purpose: the app cannot change these tables directly)

-- ---------- 3. My QR code ----------
-- Returns my active code, creating one (valid 7 days) if I have none or it has expired.
create or replace function public.get_or_create_my_qr()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.qr_invites;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'UNAUTHENTICATED', 'message', 'Please sign in.'));
  end if;

  select * into v_row from public.qr_invites
   where user_id = v_uid and is_active and expires_at > now()
   order by created_at desc limit 1;

  if not found then
    update public.qr_invites set is_active = false where user_id = v_uid and is_active;
    delete from public.qr_invites where user_id = v_uid and not is_active and created_at < now() - interval '30 days';
    insert into public.qr_invites (user_id, token, expires_at)
    values (v_uid, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), now() + interval '7 days')
    returning * into v_row;
  end if;

  return jsonb_build_object('ok', true, 'token', v_row.token, 'expires_at', v_row.expires_at);
end $$;

-- Replaces my code with a brand new one. The old code stops working immediately.
create or replace function public.regenerate_my_qr()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.qr_invites;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'UNAUTHENTICATED', 'message', 'Please sign in.'));
  end if;
  update public.qr_invites set is_active = false where user_id = v_uid and is_active;
  insert into public.qr_invites (user_id, token, expires_at)
  values (v_uid, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), now() + interval '7 days')
  returning * into v_row;
  return jsonb_build_object('ok', true, 'token', v_row.token, 'expires_at', v_row.expires_at);
end $$;

-- ---------- 4. Scanning ----------
-- Shared check used by preview and accept. Returns the code owner's id, or an error object.
create or replace function public._check_qr_token(p_token text, p_scanner uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_inv public.qr_invites;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'QR_INVALID', 'message', 'This is not a valid Arrive Notify QR code.'));
  end if;
  select * into v_inv from public.qr_invites where token = p_token;
  if not found or not v_inv.is_active then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'QR_INVALID', 'message', 'This QR code is no longer valid. Ask them to show a new one.'));
  end if;
  if v_inv.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'QR_EXPIRED', 'message', 'This QR code has expired. Ask them to open Add People and refresh it.'));
  end if;
  if v_inv.user_id = p_scanner then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'SELF_SCAN', 'message', 'This is your own QR code. Show it to someone else to scan.'));
  end if;
  return jsonb_build_object('ok', true, 'owner_id', v_inv.user_id);
end $$;

-- Shows who a code belongs to (name and picture only, never email or phone) before the scanner confirms.
create or replace function public.preview_qr(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_chk jsonb;
  v_owner uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'UNAUTHENTICATED', 'message', 'Please sign in.'));
  end if;
  v_chk := public._check_qr_token(p_token, v_uid);
  if not (v_chk ->> 'ok')::boolean then return v_chk; end if;
  v_owner := (v_chk ->> 'owner_id')::uuid;

  return jsonb_build_object(
    'ok', true,
    'person', (select jsonb_build_object(
                 'id', u.id,
                 'name', coalesce(nullif(trim(u.raw_user_meta_data ->> 'name'), ''), 'Arrive Notify user'),
                 'avatar_url', u.raw_user_meta_data ->> 'avatar_url')
                 from auth.users u where u.id = v_owner),
    'already_connected', exists (select 1 from public.user_connections c where c.user_id = v_uid and c.connected_user_id = v_owner)
  );
end $$;

-- Connects me and the code owner, in both directions, in one step. Safe to repeat (no duplicates).
create or replace function public.accept_qr_connection(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_chk jsonb;
  v_owner uuid;
  v_new int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'UNAUTHENTICATED', 'message', 'Please sign in.'));
  end if;
  v_chk := public._check_qr_token(p_token, v_uid);
  if not (v_chk ->> 'ok')::boolean then return v_chk; end if;
  v_owner := (v_chk ->> 'owner_id')::uuid;

  insert into public.user_connections (user_id, connected_user_id, status, source)
  values (v_uid, v_owner, 'accepted', 'qr'), (v_owner, v_uid, 'accepted', 'qr')
  on conflict (user_id, connected_user_id) do nothing;
  get diagnostics v_new = row_count;

  return jsonb_build_object(
    'ok', true,
    'already_connected', v_new = 0,
    'person', (select jsonb_build_object(
                 'id', u.id,
                 'name', coalesce(nullif(trim(u.raw_user_meta_data ->> 'name'), ''), 'Arrive Notify user'),
                 'avatar_url', u.raw_user_meta_data ->> 'avatar_url')
                 from auth.users u where u.id = v_owner)
  );
end $$;

-- ---------- 5. My connections ----------
create or replace function public.get_my_connections()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'UNAUTHENTICATED', 'message', 'Please sign in.'));
  end if;
  return jsonb_build_object('ok', true, 'connections', coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', c.connected_user_id,
             'name', coalesce(nullif(trim(u.raw_user_meta_data ->> 'name'), ''), 'Arrive Notify user'),
             'avatar_url', u.raw_user_meta_data ->> 'avatar_url',
             'connected_at', c.created_at,
             'source', c.source) order by c.created_at desc)
      from public.user_connections c
      join auth.users u on u.id = c.connected_user_id
     where c.user_id = v_uid and c.status = 'accepted'), '[]'::jsonb));
end $$;

-- Removes the connection for both people.
create or replace function public.remove_connection(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_n bigint;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'UNAUTHENTICATED', 'message', 'Please sign in.'));
  end if;
  delete from public.user_connections
   where (user_id = v_uid and connected_user_id = p_user_id) or (user_id = p_user_id and connected_user_id = v_uid);
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'removed', v_n > 0);
end $$;

-- ---------- 6. Permissions: signed-in users only ----------
revoke all on function public.get_or_create_my_qr() from public, anon;
revoke all on function public.regenerate_my_qr() from public, anon;
revoke all on function public._check_qr_token(text, uuid) from public, anon, authenticated;
revoke all on function public.preview_qr(text) from public, anon;
revoke all on function public.accept_qr_connection(text) from public, anon;
revoke all on function public.get_my_connections() from public, anon;
revoke all on function public.remove_connection(uuid) from public, anon;

grant execute on function public.get_or_create_my_qr() to authenticated;
grant execute on function public.regenerate_my_qr() to authenticated;
grant execute on function public.preview_qr(text) to authenticated;
grant execute on function public.accept_qr_connection(text) to authenticated;
grant execute on function public.get_my_connections() to authenticated;
grant execute on function public.remove_connection(uuid) to authenticated;
