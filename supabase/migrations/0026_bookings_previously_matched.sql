-- ============================================================================
-- 0026 — Track whether a booking was ever claimed by an expert, so the
-- day-before email can distinguish "expert unclaimed" from "never matched".
-- ============================================================================
alter table bookings add column if not exists previously_matched boolean not null default false;
