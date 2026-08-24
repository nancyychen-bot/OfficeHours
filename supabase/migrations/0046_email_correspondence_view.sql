-- ============================================================================
-- 0046 — email_correspondence: sent-email log grouped by kind + event + day
-- ============================================================================
create or replace view email_correspondence as
select
  el.event_kind,
  b.event_id,
  e.name       as event_name,
  e.event_date as event_date,
  (el.created_at at time zone 'UTC')::date as day,
  count(*)                                     as recipient_count,
  count(*) filter (where el.status = 'sent')   as sent_count,
  count(*) filter (where el.status <> 'sent')  as unsent_count,
  min(el.created_at) as first_at,
  max(el.created_at) as last_at
from email_log el
join bookings b on b.id = el.booking_id
left join events e on e.id = b.event_id
group by el.event_kind, b.event_id, e.name, e.event_date, day;
