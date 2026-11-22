-- =====================================================================================
-- Arrive Notify: Smart Privacy Settings backend
-- Run this ONCE in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Adds: privacy_settings table + 9 functions. It does not change any existing table.
-- Every function only reads or changes the signed-in user's own rows (auth.uid()).
-- =====================================================================================

-- ---------- 1. Settings table (one row per user, settings kept as JSON) ----------
create table if not exists public.privacy_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.privacy_settings enable row level security;

drop policy if exists privacy_settings_select_own on public.privacy_settings;
drop policy if exists privacy_settings_insert_own on public.privacy_settings;
drop policy if exists privacy_settings_update_own on public.privacy_settings;
drop policy if exists privacy_settings_delete_own on public.privacy_settings;
create policy privacy_settings_select_own on public.privacy_settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy privacy_settings_insert_own on public.privacy_settings for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy privacy_settings_update_own on public.privacy_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy privacy_settings_delete_own on public.privacy_settings for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------- 2. Read settings ----------
create or replace function public.get_my_privacy_settings()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_s jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'UNAUTHENTICATED', 'message', 'Please sign in.'));
  end if;
  select settings into v_s from public.privacy_settings where user_id = v_uid;
  return jsonb_build_object('ok', true, 'settings', coalesce(v_s, '{}'::jsonb));
end $$;

-- ---------- 3. Save settings (only known keys with valid values are kept) ----------
create or replace function public.update_my_privacy_settings(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_clean jsonb;
  v_new jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'UNAUTHENTICATED', 'message', 'Please sign in.'));
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_INPUT', 'message', 'Invalid settings.'));
  end if;

  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_clean
    from jsonb_each(p_patch) as t(k, v)
   where k = any (array['defaultLiveShare', 'defaultGroupIds', 'defaultPersonIds', 'journeyUpdates', 'notifyStarted',
                        'notifyNearby', 'notifyArrived', 'notifyCancelled', 'sosShareLive', 'sosCountdown', 'retentionDays']);

  begin
    if (v_clean ->> 'retentionDays') is not null and (v_clean ->> 'retentionDays')::int not in (0, 1, 7, 30) then
      raise exception 'bad retention';
    end if;
    if (v_clean ->> 'sosCountdown') is not null and (v_clean ->> 'sosCountdown')::int not in (3, 5, 10) then
      raise exception 'bad countdown';
    end if;
  exception when others then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_INPUT', 'message', 'Some of the values are not valid.'));
  end;

  insert into public.privacy_settings (user_id, settings) values (v_uid, v_clean)
  on conflict (user_id) do update
     set settings = public.privacy_settings.settings || excluded.settings, updated_at = now()
  returning settings into v_new;

  return jsonb_build_object('ok', true, 'settings', v_new);
end $$;

-- ---------- 4. Location data retention ----------
-- Deletes MY old GPS points: 0 = every finished journey, otherwise anything older than N days (default 7).
create or replace function public.apply_my_retention()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_days int;
  v_n bigint;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'UNAUTHENTICATED', 'message', 'Please sign in.'));
  end if;
  select coalesce((settings ->> 'retentionDays')::int, 7) into v_days from public.privacy_settings where user_id = v_uid;
  v_days := coalesce(v_days, 7);

  if v_days = 0 then
    delete from public.journey_locations jl using public.journeys j
     where jl.journey_id = j.id and j.user_id = v_uid and j.status <> 'active';
  else
    delete from public.journey_locations jl using public.journeys j
     where jl.journey_id = j.id and j.user_id = v_uid and jl.recorded_at < now() - make_interval(days => v_days);
  end if;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'deleted_points', v_n);
end $$;

-- Deletes the GPS points of all my finished journeys right now (the active journey is left alone)
create or replace function public.clear_my_location_history()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_n bigint;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'UNAUTHENTICATED', 'message', 'Please sign in.'));
  end if;
  delete from public.journey_locations jl using public.journeys j
   where jl.journey_id = j.id and j.user_id = v_uid and j.status <> 'active';
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'deleted_points', v_n);
end $$;

-- OPTIONAL: honours every user's retention choice even if they never open the app.
-- Not callable from the app. Schedule it with pg_cron (Database -> Extensions -> pg_cron), e.g. once a day:
--   select cron.schedule('purge-locations-by-retention', '15 3 * * *', $$select public.purge_locations_by_user_retention()$$);
create or replace function public.purge_locations_by_user_retention()
returns bigint language plpgsql security definer set search_path = public as $$
declare v_n bigint;
begin
  delete from public.journey_locations jl using public.journeys j
    left join public.privacy_settings ps on ps.user_id = j.user_id
   where jl.journey_id = j.id
     and ( (coalesce((ps.settings ->> 'retentionDays')::int, 7) = 0 and j.status <> 'active')
        or (coalesce((ps.settings ->> 'retentionDays')::int, 7) > 0
            and jl.recorded_at < now() - make_interval(days => coalesce((ps.settings ->> 'retentionDays')::int, 7))) );
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------- 5. Who can see a journey: remove one viewer from a live journey ----------
create or replace function public.revoke_journey_viewer(p_journey_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_n bigint;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'UNAUTHENTICATED', 'message', 'Please sign in.'));
  end if;
  if not exists (select 1 from public.journeys where id = p_journey_id and user_id = v_uid) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'NOT_FOUND', 'message', 'Journey not found.'));
  end if;
  update public.journey_recipients set can_track = false
   where journey_id = p_journey_id and recipient_id = p_user_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'revoked', v_n > 0);
end $$;

-- ---------- 6. Personal data ----------
create or replace function public.export_my_data()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'UNAUTHENTICATED', 'message', 'Please sign in.'));
  end if;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('id', u.id, 'email', u.email, 'name', u.raw_user_meta_data ->> 'name', 'created_at', u.created_at)
                  from auth.users u where u.id = v_uid),
    'privacy_settings', coalesce((select settings from public.privacy_settings where user_id = v_uid), '{}'::jsonb),
    'saved_places', coalesce((select jsonb_agg(to_jsonb(p)) from public.places p where p.user_id = v_uid), '[]'::jsonb),
    'journeys', coalesce((select jsonb_agg(to_jsonb(j) order by j.started_at desc) from public.journeys j where j.user_id = v_uid), '[]'::jsonb),
    'journey_recipients', coalesce((select jsonb_agg(to_jsonb(r)) from public.journey_recipients r
                                      join public.journeys j on j.id = r.journey_id where j.user_id = v_uid), '[]'::jsonb),
    'location_points_stored', (select count(*) from public.journey_locations jl
                                 join public.journeys j on j.id = jl.journey_id where j.user_id = v_uid)
  ));
end $$;

-- Deletes all FINISHED journeys (and their GPS points, recipients, events, notifications). Active journey is kept.
create or replace function public.delete_my_journey_history()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_n bigint;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'UNAUTHENTICATED', 'message', 'Please sign in.'));
  end if;
  delete from public.journeys where user_id = v_uid and status <> 'active';
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'deleted_journeys', v_n);
end $$;

-- Deletes the account and everything linked to it. It runs as one transaction: if anything blocks the
-- deletion, nothing is removed and an error is returned.
create or replace function public.delete_my_account()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'UNAUTHENTICATED', 'message', 'Please sign in.'));
  end if;
  begin
    delete from auth.users where id = v_uid;
  exception when others then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'DELETE_BLOCKED', 'message', 'Your account could not be deleted: ' || sqlerrm));
  end;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- 7. Permissions: signed-in users only ----------
revoke all on function public.get_my_privacy_settings() from public, anon;
revoke all on function public.update_my_privacy_settings(jsonb) from public, anon;
revoke all on function public.apply_my_retention() from public, anon;
revoke all on function public.clear_my_location_history() from public, anon;
revoke all on function public.revoke_journey_viewer(uuid, uuid) from public, anon;
revoke all on function public.export_my_data() from public, anon;
revoke all on function public.delete_my_journey_history() from public, anon;
revoke all on function public.delete_my_account() from public, anon;
revoke all on function public.purge_locations_by_user_retention() from public, anon, authenticated;

grant execute on function public.get_my_privacy_settings() to authenticated;
grant execute on function public.update_my_privacy_settings(jsonb) to authenticated;
grant execute on function public.apply_my_retention() to authenticated;
grant execute on function public.clear_my_location_history() to authenticated;
grant execute on function public.revoke_journey_viewer(uuid, uuid) to authenticated;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.delete_my_journey_history() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
