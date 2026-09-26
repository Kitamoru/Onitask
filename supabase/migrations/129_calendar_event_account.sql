-- 129_calendar_event_account.sql
--
-- Events could not be told apart by account, so every event block rendered in
-- the same amber regardless of which mailbox it came from. The connection is
-- what the account colour hangs off, and nothing on an event recorded it.
--
-- The order that bit us last time is respected here: migration 125 changed the
-- uniqueness key a writer depends on, in the same step that began writing
-- against it, and the two disagreed silently. This changes nothing a writer
-- depends on:
--
--   * the column is NULLABLE, so no NOT NULL to satisfy;
--   * the unique key stays (profile_id, provider, remote_event_id) and the
--     upsert still targets exactly that, so schema and writer cannot disagree;
--   * existing rows are NOT backfilled, because with two accounts connected no
--     single value would be correct. The next sync of each account rewrites its
--     own events with its own connection_id, so the column fills in naturally.
--
-- The known limitation stands: because the key is still scoped by profile and
-- provider rather than by connection, two accounts with a colliding UID will
-- overwrite each other. Fixing that means moving the key, which is a separate
-- change and should be done only after this one is proven in production.

alter table public.calendar_events
  add column if not exists connection_id uuid references public.calendar_connections (id) on delete cascade;

comment on column public.calendar_events.connection_id is
  'Account this event was synced from. NULL only for rows not yet re-synced since migration 129. Resolves the account colour and, once the uniqueness key is moved, isolates events whose UIDs collide across accounts.';
