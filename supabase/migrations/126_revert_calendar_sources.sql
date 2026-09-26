-- 126_revert_calendar_sources.sql
--
-- Reverts 125_calendar_sources. The sync could not write events after the
-- unique key moved: upsertCalendarEvent still used
-- onConflict 'profile_id,provider,remote_event_id', which 125 had dropped, so
-- every event upsert errored and synced stayed 0. The 'legacy' cleanup then
-- removed the bucket and its events cascaded away with it.
--
-- The guard was wrong in kind, not just in detail: it asked "were the
-- collections registered" rather than "were the events actually written".
--
-- Rolling back is cheap only because calendar_events is currently empty -- the
-- imported events still exist in Yandex and return on the next sync. If this
-- is ever applied when rows are present, re-sync before relying on it.
--
-- Kept for the record: the account at this point exposed two CalDAV
-- collections, and Yandex does return names --
--   /calendars/<login>/events-9527465/  -> "Мои события"
--   /calendars/<login>/todos-7699121/   -> "Не забыть"
-- Note the second one is a todo list, not events. Per-calendar naming is
-- therefore feasible, it is simply not wanted yet.

-- 1. Restore the original uniqueness first, so the old upsert target exists.
alter table public.calendar_events
  add constraint uq_calendar_events_profile_remote unique (profile_id, provider, remote_event_id);

alter table public.calendar_events
  drop constraint if exists uq_calendar_events_calendar_remote;

-- 2. Drop the hierarchy.
alter table public.calendar_events
  drop column if exists calendar_id;

drop table if exists public.profile_calendars;

alter table public.calendar_connections
  drop column if exists color_index;
