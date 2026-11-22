-- =====================================================================
-- ARRIVE NOTIFY: QUICK ARRIVAL BACKEND MIGRATION
-- Run once in Supabase: SQL Editor > New query > paste ALL > Run.
-- It is safe to run again. It runs as ONE transaction, so if anything
-- fails, NOTHING is changed. Nothing is deleted.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 0. Shared helper: keeps "updated_at" correct on every update
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- A. PLACES (existing table is reused and extended)
-- ---------------------------------------------------------------------
alter table public.places add column if not exists category text not null default 'other';
alter table public.places add column if not exists is_favorite boolean not null default false;
alter table public.places add column if not exists updated_at timestamptz not null default now();

-- Rename radius_m -> arrival_radius (only if the old name still exists)
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'places' and column_name = 'radius_m')
     and not exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'places' and column_name = 'arrival_radius') then
    alter table public.places rename column radius_m to arrival_radius;
  end if;
end;
$$;
alter table public.places add column if not exists arrival_radius integer not null default 500;

-- Data validation inside the database (cannot be bypassed by the app)
alter table public.places drop constraint if exists places_category_check;
alter table public.places add constraint places_category_check
  check (category in ('home', 'office', 'college', 'gym', 'other'));
alter table public.places drop constraint if exists places_name_check;
alter table public.places add constraint places_name_check
  check (char_length(btrim(name)) between 1 and 80);
alter table public.places drop constraint if exists places_latitude_check;
alter table public.places add constraint places_latitude_check
  check (latitude between -90 and 90);
alter table public.places drop constraint if exists places_longitude_check;
alter table public.places add constraint places_longitude_check
  check (longitude between -180 and 180);
alter table public.places drop constraint if exists places_arrival_radius_check;
alter table public.places add constraint places_arrival_radius_check
  check (arrival_radius between 50 and 5000);

-- Existing places called Home / Office / College / Gym get the matching category
update public.places
set category = lower(btrim(name))
where category = 'other' and lower(btrim(name)) in ('home', 'office', 'college', 'gym');

drop trigger if exists places_set_updated_at on public.places;
create trigger places_set_updated_at
  before update on public.places
  for each row execute function public.set_updated_at();

create index if not exists places_user_idx on public.places (user_id);

-- ---------------------------------------------------------------------
-- B. JOURNEYS (reused if it exists from the earlier migration, else created)
-- ---------------------------------------------------------------------
create table if not exists public.journeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  place_id uuid references public.places (id) on delete set null,
  destination_name text not null,                 -- snapshot: survives place edits/deletes
  destination_address text,                       -- snapshot
  status text not null default 'active' check (status in ('active', 'arrived', 'cancelled')),
  start_latitude double precision,
  start_longitude double precision,
  destination_latitude double precision not null, -- snapshot
  destination_longitude double precision not null,-- snapshot
  arrival_radius integer not null default 500,    -- snapshot
  arrival_streak integer not null default 0,      -- reliable readings in a row inside the circle
  started_at timestamptz not null default now(),
  estimated_arrival_at timestamptz,               -- stays NULL until a routing provider is connected
  arrived_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

-- If the earlier version of this table exists, rename its old columns
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('dest_lat', 'destination_latitude'),
      ('dest_lng', 'destination_longitude'),
      ('start_lat', 'start_latitude'),
      ('start_lng', 'start_longitude'),
      ('radius_m', 'arrival_radius')
    ) as t (old_name, new_name)
  loop
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'journeys' and column_name = r.old_name)
       and not exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'journeys' and column_name = r.new_name) then
      execute format('alter table public.journeys rename column %I to %I', r.old_name, r.new_name);
    end if;
  end loop;
end;
$$;

alter table public.journeys add column if not exists destination_address text;
alter table public.journeys add column if not exists arrival_radius integer not null default 500;
alter table public.journeys add column if not exists arrival_streak integer not null default 0;
alter table public.journeys add column if not exists estimated_arrival_at timestamptz;
alter table public.journeys add column if not exists cancelled_at timestamptz;
alter table public.journeys add column if not exists created_at timestamptz not null default now();

-- Old cancelled journeys: copy their end time into cancelled_at
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'journeys' and column_name = 'ended_at') then
    execute 'update public.journeys set cancelled_at = ended_at where status = ''cancelled'' and cancelled_at is null';
  end if;
end;
$$;

alter table public.journeys drop constraint if exists journeys_coords_check;
alter table public.journeys add constraint journeys_coords_check check (
  destination_latitude between -90 and 90
  and destination_longitude between -180 and 180
  and (start_latitude is null or start_latitude between -90 and 90)
  and (start_longitude is null or start_longitude between -180 and 180)
);

-- ONE active journey per user. The database itself blocks duplicates,
-- even if two requests arrive at the same moment.
create unique index if not exists one_active_journey_per_user
  on public.journeys (user_id) where status = 'active';
create index if not exists journeys_user_started_idx
  on public.journeys (user_id, started_at desc);

-- ---------------------------------------------------------------------
-- C. JOURNEY_LOCATIONS (GPS points during a journey)
-- ---------------------------------------------------------------------
create table if not exists public.journey_locations (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.journeys (id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy double precision check (accuracy is null or accuracy >= 0),
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists journey_locations_journey_idx
  on public.journey_locations (journey_id, recorded_at desc);

-- ---------------------------------------------------------------------
-- D. JOURNEY_RECIPIENTS (who should be told; delivery is a later stage)
-- ---------------------------------------------------------------------
create table if not exists public.journey_recipients (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.journeys (id) on delete cascade,
  recipient_id uuid references auth.users (id) on delete set null,
  recipient_name text not null check (char_length(btrim(recipient_name)) between 1 and 80),
  recipient_contact text,
  notification_enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists journey_recipients_journey_idx
  on public.journey_recipients (journey_id);

-- ---------------------------------------------------------------------
-- E. JOURNEY_EVENTS (arrival event). UNIQUE(journey_id, type) means an
--    "arrived" event can only ever exist once per journey.
-- ---------------------------------------------------------------------
create table if not exists public.journey_events (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.journeys (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('started', 'arrived', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (journey_id, type)
);

-- ---------------------------------------------------------------------
-- F. NOTIFICATIONS (records of messages. status 'pending' = NOT delivered)
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.journeys (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade, -- the traveller
  recipient_id uuid references auth.users (id) on delete set null,
  recipient_name text not null,
  type text not null check (type in ('arrived')),
  message text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  dedupe_key text not null unique,   -- prevents duplicate notifications
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_recipient_idx on public.notifications (recipient_id, created_at desc);

-- ---------------------------------------------------------------------
-- G. INTERNAL HELPER FUNCTIONS (not callable by app users)
-- ---------------------------------------------------------------------
create or replace function public.qa_error(p_code text, p_message text, p_extra jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'ok', false,
    'error', jsonb_build_object('code', p_code, 'message', p_message) || coalesce(p_extra, '{}'::jsonb)
  );
$$;

-- Straight-line distance in metres (haversine). Used ONLY for the arrival circle,
-- never for travel time.
create or replace function public.qa_haversine_m(
  lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision
)
returns double precision
language sql
immutable
as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
  )));
$$;

create or replace function public.qa_journey_json(j public.journeys)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', j.id,
    'place_id', j.place_id,
    'destination_name', j.destination_name,
    'destination_address', j.destination_address,
    'status', j.status,
    'start_latitude', j.start_latitude,
    'start_longitude', j.start_longitude,
    'destination_latitude', j.destination_latitude,
    'destination_longitude', j.destination_longitude,
    'arrival_radius', j.arrival_radius,
    'started_at', j.started_at,
    'estimated_arrival_at', j.estimated_arrival_at,
    'arrived_at', j.arrived_at,
    'cancelled_at', j.cancelled_at
  );
$$;

-- Marks a journey ARRIVED exactly once, creates the arrival event and the
-- pending notifications. Returns true only for the call that really changed
-- the status, so repeating it is harmless (idempotent).
create or replace function public.qa_process_arrival(p_journey_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_j public.journeys%rowtype;
  v_name text;
begin
  update public.journeys
     set status = 'arrived', arrived_at = now()
   where id = p_journey_id and status = 'active'
  returning * into v_j;

  if not found then
    return false;  -- already arrived, or cancelled: do nothing
  end if;

  insert into public.journey_events (journey_id, user_id, type)
  values (v_j.id, v_j.user_id, 'arrived')
  on conflict (journey_id, type) do nothing;

  select u.raw_user_meta_data ->> 'name' into v_name from auth.users u where u.id = v_j.user_id;

  insert into public.notifications (journey_id, user_id, recipient_id, recipient_name, type, message, status, dedupe_key)
  select v_j.id, v_j.user_id, r.recipient_id, r.recipient_name, 'arrived',
         coalesce(nullif(btrim(v_name), ''), 'Your contact') || ' has arrived at ' || v_j.destination_name || '.',
         'pending',
         v_j.id::text || ':arrived:' || coalesce(r.recipient_id::text, lower(r.recipient_name))
    from public.journey_recipients r
   where r.journey_id = v_j.id and r.notification_enabled
  on conflict (dedupe_key) do nothing;

  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- H. APP FUNCTIONS (called with supabase.rpc). Every one of them checks
--    auth.uid() and only touches rows owned by that user.
--    They return {"ok": true, ...} or {"ok": false, "error": {code, message}}.
-- ---------------------------------------------------------------------

-- 5. startQuickJourney
create or replace function public.start_quick_journey(
  p_place_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy double precision default null,
  p_recipients jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_place public.places%rowtype;
  v_journey public.journeys%rowtype;
  v_existing public.journeys%rowtype;
  v_rec jsonb;
begin
  if v_uid is null then
    return public.qa_error('UNAUTHENTICATED', 'You must be logged in.');
  end if;
  if p_place_id is null then
    return public.qa_error('INVALID_PLACE', 'Choose a destination first.');
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    return public.qa_error('INVALID_COORDINATES', 'Your current location is not valid.');
  end if;
  if p_accuracy is not null and p_accuracy < 0 then
    return public.qa_error('INVALID_COORDINATES', 'Location accuracy cannot be negative.');
  end if;
  if p_recipients is null or jsonb_typeof(p_recipients) <> 'array' or jsonb_array_length(p_recipients) > 20 then
    return public.qa_error('INVALID_RECIPIENTS', 'Recipients must be a list of at most 20 people.');
  end if;
  for v_rec in select * from jsonb_array_elements(p_recipients) loop
    if coalesce(btrim(v_rec ->> 'recipient_name'), '') = '' or char_length(v_rec ->> 'recipient_name') > 80 then
      return public.qa_error('INVALID_RECIPIENTS', 'Every recipient needs a name of up to 80 characters.');
    end if;
    if nullif(v_rec ->> 'recipient_id', '') is not null
       and (v_rec ->> 'recipient_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return public.qa_error('INVALID_RECIPIENTS', 'A recipient id is not valid.');
    end if;
  end loop;

  -- The place must exist AND belong to this user
  select * into v_place from public.places where id = p_place_id and user_id = v_uid;
  if not found then
    return public.qa_error('PLACE_NOT_FOUND', 'That destination was not found.');
  end if;

  select * into v_existing from public.journeys where user_id = v_uid and status = 'active' limit 1;
  if found then
    return public.qa_error('ACTIVE_JOURNEY_EXISTS', 'You already have an active journey.',
                           jsonb_build_object('journey', public.qa_journey_json(v_existing)));
  end if;

  begin
    insert into public.journeys (
      user_id, place_id, destination_name, destination_address, status,
      start_latitude, start_longitude, destination_latitude, destination_longitude, arrival_radius
    ) values (
      v_uid, v_place.id, v_place.name, v_place.address, 'active',
      p_latitude, p_longitude, v_place.latitude, v_place.longitude, v_place.arrival_radius
    )
    returning * into v_journey;
  exception when unique_violation then
    -- Two requests at the same time: the unique index lets only one win
    select * into v_existing from public.journeys where user_id = v_uid and status = 'active' limit 1;
    return public.qa_error('ACTIVE_JOURNEY_EXISTS', 'You already have an active journey.',
                           jsonb_build_object('journey', public.qa_journey_json(v_existing)));
  end;

  insert into public.journey_recipients (journey_id, recipient_id, recipient_name, recipient_contact, notification_enabled)
  select v_journey.id,
         nullif(e ->> 'recipient_id', '')::uuid,
         btrim(e ->> 'recipient_name'),
         nullif(btrim(coalesce(e ->> 'recipient_contact', '')), ''),
         coalesce((e ->> 'notification_enabled')::boolean, true)
    from jsonb_array_elements(p_recipients) as e;

  insert into public.journey_events (journey_id, user_id, type) values (v_journey.id, v_uid, 'started');

  insert into public.journey_locations (journey_id, latitude, longitude, accuracy, recorded_at)
  values (v_journey.id, p_latitude, p_longitude, p_accuracy, now());

  return jsonb_build_object(
    'ok', true,
    'journey', public.qa_journey_json(v_journey),
    'distance_m', round(public.qa_haversine_m(p_latitude, p_longitude, v_journey.destination_latitude, v_journey.destination_longitude)),
    'eta_seconds', null,
    'estimated_arrival_at', null
  );
end;
$$;

-- 6. getActiveJourney
create or replace function public.get_active_journey()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_j public.journeys%rowtype;
begin
  if v_uid is null then
    return public.qa_error('UNAUTHENTICATED', 'You must be logged in.');
  end if;
  select * into v_j from public.journeys where user_id = v_uid and status = 'active' limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'journey', null);
  end if;
  return jsonb_build_object('ok', true, 'journey', public.qa_journey_json(v_j));
end;
$$;

-- 7. updateJourneyLocation (also does the arrival detection)
create or replace function public.update_journey_location(
  p_journey_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy double precision default null,
  p_recorded_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_j public.journeys%rowtype;
  v_last public.journey_locations%rowtype;
  v_has_last boolean;
  v_at timestamptz := coalesce(p_recorded_at, now());
  v_dist double precision;
  v_reliable boolean;
  v_streak integer;
  v_store boolean := true;
  v_new_arrival boolean := false;
begin
  if v_uid is null then
    return public.qa_error('UNAUTHENTICATED', 'You must be logged in.');
  end if;
  if p_journey_id is null then
    return public.qa_error('JOURNEY_NOT_FOUND', 'Journey not found.');
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    return public.qa_error('INVALID_COORDINATES', 'Latitude or longitude is not valid.');
  end if;
  if p_accuracy is not null and p_accuracy < 0 then
    return public.qa_error('INVALID_COORDINATES', 'Location accuracy cannot be negative.');
  end if;

  -- Lock this journey row: simultaneous updates are handled one at a time
  select * into v_j from public.journeys where id = p_journey_id and user_id = v_uid for update;
  if not found then
    return public.qa_error('JOURNEY_NOT_FOUND', 'Journey not found.');
  end if;
  if v_j.status <> 'active' then
    return public.qa_error('JOURNEY_NOT_ACTIVE', 'This journey is no longer active.',
                           jsonb_build_object('status', v_j.status));
  end if;

  if v_at > now() + interval '1 minute' then
    return public.qa_error('INVALID_TIMESTAMP', 'The location time is in the future.');
  end if;
  if v_at < now() - interval '1 hour' then
    return public.qa_error('OUTDATED_LOCATION', 'The location reading is too old.');
  end if;

  select * into v_last from public.journey_locations where journey_id = v_j.id order by recorded_at desc limit 1;
  v_has_last := found;
  if v_has_last and v_at <= v_last.recorded_at then
    return public.qa_error('OUTDATED_LOCATION', 'A newer location was already received.');
  end if;

  v_dist := public.qa_haversine_m(p_latitude, p_longitude, v_j.destination_latitude, v_j.destination_longitude);

  -- GPS drift protection: a reading with accuracy worse than 100 m is stored
  -- but never counts toward arrival. Two reliable readings in a row inside the
  -- circle are required.
  v_reliable := (p_accuracy is null or p_accuracy <= 100);
  v_streak := v_j.arrival_streak;
  if v_reliable then
    if v_dist <= v_j.arrival_radius then
      v_streak := v_streak + 1;
    else
      v_streak := 0;
    end if;
  end if;

  -- Store less data: skip points that are under 10 m and under 30 s from the last stored point
  if v_has_last
     and (v_at - v_last.recorded_at) < interval '30 seconds'
     and public.qa_haversine_m(p_latitude, p_longitude, v_last.latitude, v_last.longitude) < 10 then
    v_store := false;
  end if;

  if v_store then
    insert into public.journey_locations (journey_id, latitude, longitude, accuracy, recorded_at)
    values (v_j.id, p_latitude, p_longitude, p_accuracy, v_at);
  end if;

  update public.journeys set arrival_streak = v_streak where id = v_j.id;

  if v_streak >= 2 then
    v_new_arrival := public.qa_process_arrival(v_j.id);
  end if;

  select * into v_j from public.journeys where id = v_j.id;

  return jsonb_build_object(
    'ok', true,
    'accepted', true,
    'stored', v_store,
    'counted_for_arrival', v_reliable,
    'distance_m', round(v_dist),
    'status', v_j.status,
    'arrived', (v_j.status = 'arrived'),
    'newly_arrived', v_new_arrival,
    'eta_seconds', null,
    'estimated_arrival_at', null,
    'journey', public.qa_journey_json(v_j)
  );
end;
$$;

-- 8. cancelJourney
create or replace function public.cancel_journey(p_journey_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_j public.journeys%rowtype;
begin
  if v_uid is null then
    return public.qa_error('UNAUTHENTICATED', 'You must be logged in.');
  end if;
  select * into v_j from public.journeys where id = p_journey_id and user_id = v_uid for update;
  if not found then
    return public.qa_error('JOURNEY_NOT_FOUND', 'Journey not found.');
  end if;
  if v_j.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'already_cancelled', true, 'journey', public.qa_journey_json(v_j));
  end if;
  if v_j.status <> 'active' then
    return public.qa_error('JOURNEY_NOT_ACTIVE', 'This journey has already finished.',
                           jsonb_build_object('status', v_j.status));
  end if;

  update public.journeys set status = 'cancelled', cancelled_at = now()
   where id = v_j.id and status = 'active'
  returning * into v_j;

  insert into public.journey_events (journey_id, user_id, type)
  values (v_j.id, v_uid, 'cancelled')
  on conflict (journey_id, type) do nothing;

  return jsonb_build_object('ok', true, 'already_cancelled', false, 'journey', public.qa_journey_json(v_j));
end;
$$;

-- 9. completeJourney (manual arrival, validated against the arrival circle)
create or replace function public.complete_journey(
  p_journey_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_j public.journeys%rowtype;
  v_dist double precision;
  v_new boolean;
begin
  if v_uid is null then
    return public.qa_error('UNAUTHENTICATED', 'You must be logged in.');
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    return public.qa_error('INVALID_COORDINATES', 'Latitude or longitude is not valid.');
  end if;
  select * into v_j from public.journeys where id = p_journey_id and user_id = v_uid for update;
  if not found then
    return public.qa_error('JOURNEY_NOT_FOUND', 'Journey not found.');
  end if;
  if v_j.status = 'arrived' then
    return jsonb_build_object('ok', true, 'already_arrived', true, 'newly_arrived', false,
                              'journey', public.qa_journey_json(v_j));
  end if;
  if v_j.status <> 'active' then
    return public.qa_error('JOURNEY_NOT_ACTIVE', 'This journey is no longer active.',
                           jsonb_build_object('status', v_j.status));
  end if;

  v_dist := public.qa_haversine_m(p_latitude, p_longitude, v_j.destination_latitude, v_j.destination_longitude);
  -- allow up to 50 m of extra tolerance for GPS inaccuracy
  if v_dist > v_j.arrival_radius + least(coalesce(p_accuracy, 0), 50) then
    return public.qa_error('NOT_AT_DESTINATION', 'You are not inside the arrival circle yet.',
                           jsonb_build_object('distance_m', round(v_dist), 'arrival_radius', v_j.arrival_radius));
  end if;

  v_new := public.qa_process_arrival(v_j.id);
  select * into v_j from public.journeys where id = v_j.id;

  return jsonb_build_object('ok', true, 'already_arrived', not v_new, 'newly_arrived', v_new,
                            'journey', public.qa_journey_json(v_j));
end;
$$;

-- 10. getJourneyHistory (pagination + sorting)
create or replace function public.get_journey_history(
  p_limit integer default 20,
  p_offset integer default 0,
  p_status text default null,
  p_sort text default 'desc'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_sort text := case when lower(coalesce(p_sort, 'desc')) = 'asc' then 'asc' else 'desc' end;
  v_total bigint;
  v_items jsonb;
begin
  if v_uid is null then
    return public.qa_error('UNAUTHENTICATED', 'You must be logged in.');
  end if;
  if p_status is not null and p_status not in ('active', 'arrived', 'cancelled') then
    return public.qa_error('INVALID_STATUS', 'Status must be active, arrived or cancelled.');
  end if;

  select count(*) into v_total from public.journeys j
   where j.user_id = v_uid and (p_status is null or j.status = p_status);

  select coalesce(jsonb_agg(p.item || jsonb_build_object('duration_seconds', p.dur) order by p.ord), '[]'::jsonb)
    into v_items
  from (
    select public.qa_journey_json(j) as item,
           case
             when j.arrived_at is not null then extract(epoch from (j.arrived_at - j.started_at))::bigint
             when j.cancelled_at is not null then extract(epoch from (j.cancelled_at - j.started_at))::bigint
           end as dur,
           row_number() over (
             order by case when v_sort = 'asc' then j.started_at end asc, j.started_at desc
           ) as ord
      from public.journeys j
     where j.user_id = v_uid and (p_status is null or j.status = p_status)
     order by ord
     limit v_limit offset v_offset
  ) p;

  return jsonb_build_object('ok', true, 'items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

-- getLatestJourneyLocation
create or replace function public.get_latest_journey_location(p_journey_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_l public.journey_locations%rowtype;
begin
  if v_uid is null then
    return public.qa_error('UNAUTHENTICATED', 'You must be logged in.');
  end if;
  if not exists (select 1 from public.journeys where id = p_journey_id and user_id = v_uid) then
    return public.qa_error('JOURNEY_NOT_FOUND', 'Journey not found.');
  end if;
  select * into v_l from public.journey_locations where journey_id = p_journey_id order by recorded_at desc limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'location', null);
  end if;
  return jsonb_build_object('ok', true, 'location', jsonb_build_object(
    'latitude', v_l.latitude, 'longitude', v_l.longitude, 'accuracy', v_l.accuracy, 'recorded_at', v_l.recorded_at));
end;
$$;

-- Retention: delete location points older than N days. Not callable by app users.
create or replace function public.purge_old_journey_locations(p_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  delete from public.journey_locations where recorded_at < now() - make_interval(days => p_days);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
-- Optional daily schedule (needs the pg_cron extension enabled in Supabase):
--   select cron.schedule('purge-journey-locations', '0 3 * * *', $$select public.purge_old_journey_locations(7)$$);

-- ---------------------------------------------------------------------
-- I. WHO CAN CALL WHAT
-- ---------------------------------------------------------------------
revoke all on function public.qa_error(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.qa_haversine_m(double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.qa_journey_json(public.journeys) from public, anon, authenticated;
revoke all on function public.qa_process_arrival(uuid) from public, anon, authenticated;
revoke all on function public.purge_old_journey_locations(integer) from public, anon, authenticated;

revoke all on function public.start_quick_journey(uuid, double precision, double precision, double precision, jsonb) from public, anon;
revoke all on function public.get_active_journey() from public, anon;
revoke all on function public.update_journey_location(uuid, double precision, double precision, double precision, timestamptz) from public, anon;
revoke all on function public.cancel_journey(uuid) from public, anon;
revoke all on function public.complete_journey(uuid, double precision, double precision, double precision) from public, anon;
revoke all on function public.get_journey_history(integer, integer, text, text) from public, anon;
revoke all on function public.get_latest_journey_location(uuid) from public, anon;

grant execute on function public.start_quick_journey(uuid, double precision, double precision, double precision, jsonb) to authenticated;
grant execute on function public.get_active_journey() to authenticated;
grant execute on function public.update_journey_location(uuid, double precision, double precision, double precision, timestamptz) to authenticated;
grant execute on function public.cancel_journey(uuid) to authenticated;
grant execute on function public.complete_journey(uuid, double precision, double precision, double precision) to authenticated;
grant execute on function public.get_journey_history(integer, integer, text, text) to authenticated;
grant execute on function public.get_latest_journey_location(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- J. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
-- places: the signed-in owner can read, add, edit and delete ONLY their own rows
alter table public.places enable row level security;
drop policy if exists "own places only" on public.places;
drop policy if exists places_select_own on public.places;
drop policy if exists places_insert_own on public.places;
drop policy if exists places_update_own on public.places;
drop policy if exists places_delete_own on public.places;
create policy places_select_own on public.places for select to authenticated
  using (user_id = (select auth.uid()));
create policy places_insert_own on public.places for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy places_update_own on public.places for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy places_delete_own on public.places for delete to authenticated
  using (user_id = (select auth.uid()));

-- journeys and everything that belongs to a journey: READ-ONLY for the app.
-- All writes go through the functions above, so nobody can edit a journey
-- status or insert GPS points by hand.
alter table public.journeys enable row level security;
alter table public.journey_locations enable row level security;
alter table public.journey_recipients enable row level security;
alter table public.journey_events enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "own journeys" on public.journeys;
drop policy if exists journeys_select_own on public.journeys;
create policy journeys_select_own on public.journeys for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists journey_locations_select_own on public.journey_locations;
create policy journey_locations_select_own on public.journey_locations for select to authenticated
  using (exists (select 1 from public.journeys j where j.id = journey_id and j.user_id = (select auth.uid())));

drop policy if exists journey_recipients_select_own on public.journey_recipients;
create policy journey_recipients_select_own on public.journey_recipients for select to authenticated
  using (exists (select 1 from public.journeys j where j.id = journey_id and j.user_id = (select auth.uid())));

drop policy if exists journey_events_select_own on public.journey_events;
create policy journey_events_select_own on public.journey_events for select to authenticated
  using (user_id = (select auth.uid()));

-- notifications: the traveller sees their own, and a recipient sees ONLY
-- the notifications addressed to them (never the journey or GPS data).
drop policy if exists notifications_select_related on public.notifications;
create policy notifications_select_related on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) or recipient_id = (select auth.uid()));

-- Table privileges: no direct writes to journey tables, nothing for anonymous users
revoke all on public.journeys, public.journey_locations, public.journey_recipients,
              public.journey_events, public.notifications from anon;
revoke insert, update, delete, truncate on public.journeys, public.journey_locations,
              public.journey_recipients, public.journey_events, public.notifications from authenticated;
grant select on public.journeys, public.journey_locations, public.journey_recipients,
              public.journey_events, public.notifications to authenticated;

notify pgrst, 'reload schema';

commit;
