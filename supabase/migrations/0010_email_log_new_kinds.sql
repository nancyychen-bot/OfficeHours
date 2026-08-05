-- ============================================================================
-- 0010 — Allow the new comms kinds in email_log
-- The comms layer added `cancelled` and `expert_unavailable`, but the
-- event_kind CHECK still only permitted the original three, so reserving a send
-- slot for those kinds threw and the emails never went out.
-- ============================================================================
alter table email_log drop constraint email_log_event_kind_check;
alter table email_log add constraint email_log_event_kind_check
  check (event_kind in ('assigned', 'checked_in', 'no_show', 'cancelled', 'expert_unavailable'));
