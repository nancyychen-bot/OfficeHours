-- booking_details was created with `select b.*` in 0001, BEFORE booked_by_email
-- was added to bookings (0004). A view's `*` is expanded at creation time and
-- does NOT pick up later columns, so booked_by_email was missing from the view —
-- which made comms read the helper's email as null and skip helper emails.
-- Drop + recreate so `b.*` re-expands to the current bookings columns.
drop view if exists booking_details;

create view booking_details as
select
  b.*,
  e.city         as location,
  e.name         as event_name,
  e.event_date,
  e.timezone,
  s.name         as slot_name,
  s.starts_at    as slot_starts_at,
  s.ends_at      as slot_ends_at
from bookings b
join events e on e.id = b.event_id
left join slots s on s.id = b.slot_id;
