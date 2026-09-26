-- 127_multiple_calendar_accounts.sql
--
-- Allows two Yandex logins on one profile (a freelancer with a personal and a
-- team mailbox). The account login becomes part of the natural key: the same
-- address re-authorised updates its own row, a different address adds another.
--
-- Deliberately minimal, and deliberately unlike 125: this only reshapes a
-- constraint on calendar_connections. calendar_events is not touched, no key
-- that any writer depends on is moved, nothing is rewritten and no cascade
-- fires. The failure mode is therefore a functional one (an ambiguous lookup)
-- rather than a destructive one -- which is why calendar-sync now addresses
-- every connection by id and checks ownership before touching it.
--
-- provider_account_email is NOT NULL, so the key cannot be defeated by two
-- rows with a missing login, which is how a nullable column would behave.

alter table public.calendar_connections
  drop constraint if exists uq_calendar_connections_profile_provider;

alter table public.calendar_connections
  add constraint uq_calendar_connections_profile_provider_account
    unique (profile_id, provider, provider_account_email);

comment on constraint uq_calendar_connections_profile_provider_account
  on public.calendar_connections is
  'One row per calendar account. Re-authorising the same login updates it; a different login adds a row.';
