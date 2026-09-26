-- 124_calendar_event_all_day.sql
--
-- All-day events (iCal VALUE=DATE) were stored as UTC midnight, which in any
-- timezone east of Greenwich renders as 00:00-03:00 and therefore lands on the
-- time axis as if it were a real meeting at that hour. The schema had no way to
-- say "this is a date, not an instant", so the information was lost on write.
--
-- The flag lets the client show these as an all-day row above the axis instead
-- of a timed block, which is also how Yandex and iOS present them.
--
-- Default false so existing rows keep their current meaning; the next CalDAV
-- sync rewrites them with the correct flag. Existing all-day events stay at
-- 00:00 UTC until then, which is no worse than before.

alter table public.calendar_events
  add column if not exists is_all_day boolean not null default false;

comment on column public.calendar_events.is_all_day is
  'True for iCal VALUE=DATE events. Their start_at/end_at are UTC midnights used as date markers, not instants; render them as all-day rows, not on the hourly axis.';
