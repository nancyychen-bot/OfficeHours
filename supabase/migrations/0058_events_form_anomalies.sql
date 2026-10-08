-- Registration-form shape anomalies detected at event registration (classifyForm).
-- Null = never classified (pre-existing events); [] = classified clean. Read by
-- /readiness + the operator alert email; NOT used by the Luma ingest path.
alter table public.events
  add column if not exists form_anomalies jsonb;
