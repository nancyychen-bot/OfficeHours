-- ============================================================================
-- 0014 — Store the event's specific street address (for calendar invites)
-- Notion "Location" stays the city (a filterable select); the calendar invite
-- and email use the full address when available, falling back to the city.
-- ============================================================================
alter table events add column address text;

drop view booking_details;
create view booking_details as
  select
    b.*,
    e.city      as location,
    e.address   as address,
    e.name      as event_name,
    e.event_date,
    e.timezone,
    s.name      as slot_name,
    s.starts_at as slot_starts_at,
    s.ends_at   as slot_ends_at
  from bookings b
  join events e on e.id = b.event_id
  left join slots s on s.id = b.slot_id;
