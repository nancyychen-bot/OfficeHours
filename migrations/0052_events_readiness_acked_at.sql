-- 0052_events_readiness_acked_at.sql
-- Operator "mark complete" on the readiness page: when set, the event has been
-- reviewed/handled and drops out of the daily readiness alert email. The page
-- still shows live checks underneath, so completing never hides a real problem.
alter table public.events add column if not exists readiness_acked_at timestamptz;
