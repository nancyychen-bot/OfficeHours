-- ============================================================================
-- 0020 — events.feedback_sent_at: one-shot marker so the post-event feedback
-- email is dispatched exactly once, the minute the event's last slot ends.
-- ============================================================================
alter table events add column if not exists feedback_sent_at timestamptz;
