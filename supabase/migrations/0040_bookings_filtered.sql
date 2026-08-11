-- 0040_bookings_filtered.sql
-- Organizer triage flag: hide obviously-bad candidates from the Notion bookings
-- DBs (via a per-workspace view filter) without a Luma decline/email. Synced like
-- luma_status; never written back to Luma.
alter table bookings add column if not exists filtered boolean not null default false;
