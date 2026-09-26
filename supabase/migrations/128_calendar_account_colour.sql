-- 128_calendar_account_colour.sql
--
-- Both connected accounts rendered the same amber, because the colour was
-- derived from `provider` and Yandex is the only provider. With one account
-- that was invisible; with two it made them indistinguishable.
--
-- Colour belongs to the account, not the provider: with several mailboxes the
-- practical question is which one an event came from.
--
-- Purely additive: one column with a default, no constraint touched, no key a
-- writer depends on moved, no cascade. Deliberately unlike 125.

alter table public.calendar_connections
  add column if not exists color_index integer not null default 0;

-- Assigned in connection order so the first account a user adds keeps the
-- first slot. Written once here; the sync upsert does not include this column,
-- so a later re-authorisation cannot move an account to another colour.
update public.calendar_connections c
set color_index = s.rn - 1
from (
  select id, row_number() over (order by connected_at, id) as rn
  from public.calendar_connections
) s
where s.id = c.id;

comment on column public.calendar_connections.color_index is
  'Palette slot for this account. Assigned at creation; no wrapping is applied, so slots past the palette size render neutral instead of duplicating a colour already in use.';
