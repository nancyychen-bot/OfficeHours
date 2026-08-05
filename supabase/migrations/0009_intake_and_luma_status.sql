-- ============================================================================
-- 0009 — Full intake capture + Luma approval status
-- Adds the approval axis (luma_status), the "no help needed" assignment state,
-- and the new registration-form fields. Requested slot is stored as a text
-- PREFERENCE and is NOT a slot reservation (slot_id still binds only on claim).
-- ============================================================================

-- Approval axis (separate from the assignment `status`).
create type luma_status as enum ('pending', 'approved', 'waitlist', 'declined');

-- New assignment state for guests who did not request 1:1 help.
-- (Safe inside this migration: no statement below references the literal.)
alter type booking_status add value if not exists 'no_help_needed';

alter table bookings
  add column luma_status      luma_status not null default 'pending',
  add column notion_email     text,
  add column notion_plan      text,
  add column experience_level text,
  add column attend_reasons   text,   -- Luma multi-select, comma-joined
  add column requested_slot   text;   -- text preference; NOT a slot_id reservation

create index bookings_luma_status_idx on bookings (luma_status);

-- Recreate the view so its `select b.*` picks up the new columns.
drop view booking_details;
create view booking_details as
  select
    b.*,
    e.city      as location,
    e.name      as event_name,
    e.event_date,
    e.timezone,
    s.name      as slot_name,
    s.starts_at as slot_starts_at,
    s.ends_at   as slot_ends_at
  from bookings b
  join events e on e.id = b.event_id
  left join slots s on s.id = b.slot_id;
