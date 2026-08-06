-- ============================================================================
-- 0022 — Cache authoritative Luma per-event stats for the results dashboard.
-- luma_stats: { registered, approved, checkedIn, waitlist, pending, capacity }
-- ============================================================================
alter table events
  add column if not exists luma_stats jsonb,
  add column if not exists luma_synced_at timestamptz;
