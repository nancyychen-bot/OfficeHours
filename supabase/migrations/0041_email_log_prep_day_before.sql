-- ============================================================================
-- 0041 — prep_reminder_day_before comms kind (T-1 reminder to Free approved guests)
-- ============================================================================
alter table email_log drop constraint email_log_event_kind_check;
alter table email_log add constraint email_log_event_kind_check
  check (event_kind in (
    'assigned', 'checked_in', 'no_show', 'cancelled', 'expert_unavailable',
    'declined', 'waitlisted', 'event_cancelled', 'arrived_after_no_show',
    'double_booked', 'feedback_request', 'prep_reminder', 'rematch_pending',
    'unmatched_notice', 'reassigned_off', 'already_claimed', 'day_of_agenda',
    'unclaim_denied', 'slot_changed', 'prep_reminder_day_before'
  ));
