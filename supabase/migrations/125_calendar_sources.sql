-- 125_calendar_sources.sql
--
-- Opens the "account -> calendar -> event" hierarchy that the calendar UI
-- needs. Today the sync flattens every CalDAV subcollection into one array
-- and hardcodes provider='yandex', so which calendar an event came from is lost
-- on the way in. That blocks per-account colouring, per-calendar visibility,
-- and event de-duplication across collections.
--
-- Kept deliberately additive and ordered so each step is independently safe:
--   1. new table
--   2. new nullable column on events
--   3. backfill
--   4. make it NOT NULL
--   5. swap the uniqueness key
--
-- The unique swap is why this cannot be skipped: the old key
-- (profile_id, provider, remote_event_id) lets two collections in the same
-- account overwrite each other whenever their UIDs collide.

-- ─── 1. calendars inside one account ────────────────────────────────────────
create table if not exists public.profile_calendars (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  -- CalDAV collection href, e.g. /calendars/<login>/events-9527465/
  ref text not null,
  -- Yandex does not necessarily return a name; NULL means "fall back to the
  -- account label" rather than a broken placeholder.
  name text,
  -- Stable colour slot. Read from the ACCOUNT, not from here: one colour per
  -- account is the distinction people actually ask for.
  color_index integer not null default 0,
  is_visible boolean not null default true,
  constraint profile_calendars_connection_id_fkey
    foreign key (connection_id) references public.calendar_connections (id) on delete cascade,
  constraint profile_calendars_color_index_check
    check (color_index >= 0),
  constraint uq_profile_calendars_connection_ref unique (connection_id, ref)
);

create index if not exists idx_profile_calendars_connection_id
  on public.profile_calendars (connection_id);

comment on table public.profile_calendars is
  'One row per CalDAV collection inside a calendar account. Events point here via calendar_events.calendar_id.';
comment on column public.profile_calendars.name is
  'Display name from the CalDAV displayname property. NULL when the provider does not return one.';
comment on column public.profile_calendars.ref is
  'CalDAV collection href. Required and stable: the fallback identity when no name is available.';

-- ─── 2. events gain a calendar ─────────────────────────────────────────────
alter table public.calendar_events
  add column if not exists calendar_id uuid references public.profile_calendars (id) on delete cascade;

-- ─── 3. backfill existing events into one synthetic calendar per account ────
-- Existing rows predate the hierarchy. They are attributed to a single bucket
-- per account so nothing is lost and the column can be made NOT NULL. The ref
-- is a sentinel rather than a CalDAV href; the next sync replaces it.
insert into public.profile_calendars (connection_id, ref, name)
select c.id, 'legacy', null
from public.calendar_connections c
on conflict (connection_id, ref) do nothing;

update public.calendar_events e
set calendar_id = pc.id
from public.calendar_connections c
join public.profile_calendars pc
  on pc.connection_id = c.id and pc.ref = 'legacy'
where e.profile_id = c.profile_id and e.calendar_id is null;

-- ─── 4. from here on every event belongs to a calendar ─────────────────────
alter table public.calendar_events
  alter column calendar_id set not null;

-- ─── 5. uniqueness moves from "profile + provider" to "calendar" ────────────
alter table public.calendar_events
  drop constraint if exists uq_calendar_events_profile_remote;

alter table public.calendar_events
  add constraint uq_calendar_events_calendar_remote unique (calendar_id, remote_event_id);

-- ─── per-account colour slot ───────────────────────────────────────────────
alter table public.calendar_connections
  add column if not exists color_index integer not null default 0;

comment on column public.calendar_connections.color_index is
  'Stable colour slot for the account. Assigned at creation so deleting one account does not shift the colours of the others.';

update public.calendar_connections c
set color_index = s.rn - 1
from (
  select id, row_number() over (order by connected_at, id) as rn
  from public.calendar_connections
) s
where s.id = c.id;
