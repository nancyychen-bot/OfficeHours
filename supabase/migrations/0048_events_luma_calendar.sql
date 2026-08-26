-- Multi-calendar Luma support: tag each event with the calendar it belongs to.
-- Existing rows default to 'default' (the original LUMA_API_KEY) — no backfill.
-- The keyring id lives in lib/luma/calendars.ts; the tag is set at add-event
-- ingest by probing each calendar's API key.
alter table events add column if not exists luma_calendar text not null default 'default';
comment on column events.luma_calendar is 'Luma calendar keyring id (see lib/luma/calendars.ts). Default calendar = the original LUMA_API_KEY.';
