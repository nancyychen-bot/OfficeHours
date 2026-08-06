-- ============================================================================
-- 0021 — Persist feedback response content on feedback_mirror so the hub can
-- list responses and aggregate results in SQL (no live Notion reads).
-- ============================================================================
alter table feedback_mirror
  add column if not exists guest_name text,
  add column if not exists guest_email text,
  add column if not exists satisfaction_score int,
  add column if not exists satisfaction_label text,
  add column if not exists confidence text,
  add column if not exists interests text[],
  add column if not exists feature_intent text,
  add column if not exists highlight text,
  add column if not exists notion_expert text,
  add column if not exists submitted_at timestamptz;
