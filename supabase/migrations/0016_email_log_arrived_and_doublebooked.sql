-- ============================================================================
-- 0016 — Two new comms kinds
--   arrived_after_no_show: a guest checks in after being marked no-show → tell the expert
--   double_booked:         an expert claims 2+ guests in the same slot → warn them
-- ============================================================================
alter table email_log drop constraint email_log_event_kind_check;
alter table email_log add constraint email_log_event_kind_check
  check (event_kind in (
    'assigned', 'checked_in', 'no_show', 'cancelled', 'expert_unavailable',
    'declined', 'waitlisted', 'event_cancelled', 'arrived_after_no_show', 'double_booked'
  ));
