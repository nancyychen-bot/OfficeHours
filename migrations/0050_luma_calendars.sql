-- 0050_luma_calendars.sql
-- Luma calendars keyring in the DB (mirrors slack_channels posture):
-- RLS enabled with NO policies → anon/authenticated blocked, service-role bypasses.
create table if not exists public.luma_calendars (
  id             text primary key,          -- slug, also events.luma_calendar (e.g. 'default','sydney','london')
  api_key        text not null,             -- service-role only
  webhook_secret text,                      -- optional (inbound guest sync)
  calendar_id    text,                      -- Luma 'cal-…' id
  city           text,                      -- default city (seeds slack routing)
  calendar_url   text,                      -- 'follow our calendar' link for guest emails
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.luma_calendars enable row level security;
-- No policies on purpose: only the service-role client (which bypasses RLS) reads/writes.

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_luma_calendars_updated_at on public.luma_calendars;
create trigger trg_luma_calendars_updated_at
  before update on public.luma_calendars
  for each row execute function public.set_updated_at();
