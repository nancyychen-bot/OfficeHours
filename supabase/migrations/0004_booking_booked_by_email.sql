-- The assigned helper's email (read from their Notion Person at claim time),
-- used to send check-in / cancellation notifications.
alter table bookings add column if not exists booked_by_email text;
