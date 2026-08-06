-- ============================================================================
-- 0023 — Editable email copy: per-template draft + live overrides.
-- Empty row / null fields ⇒ fall back to the built-in default in code.
-- ============================================================================
create table if not exists email_overrides (
  key text primary key,
  draft_subject text,
  draft_body text,
  draft_note text,
  draft_updated_at timestamptz,
  live_subject text,
  live_body text,
  live_updated_at timestamptz
);
