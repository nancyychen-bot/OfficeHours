-- ============================================================================
-- 0013 — Allow the `event_cancelled` comms kind in email_log
-- When a whole Luma event is cancelled, every booking gets an event-cancellation
-- email + calendar cancel.
-- ============================================================================
alter table email_log drop constraint email_log_event_kind_check;
alter table email_log add constraint email_log_event_kind_check
  check (event_kind in ('assigned', 'checked_in', 'no_show', 'cancelled', 'expert_unavailable', 'declined', 'waitlisted', 'event_cancelled'));
