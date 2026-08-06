-- ============================================================================
-- 0024 — Store each event's public Luma URL so emails can link to it
-- (e.g. "cancel your registration" → the event page).
-- ============================================================================
alter table events add column if not exists public_url text;
