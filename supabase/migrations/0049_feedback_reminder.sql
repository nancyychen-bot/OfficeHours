-- ============================================================================
-- 0049 — feedback_reminder: 2-days-after nudge to checked-in non-responders
-- ============================================================================

-- New comms kind so the reminder isn't deduped against the first feedback email.
alter table email_log drop constraint email_log_event_kind_check;
alter table email_log add constraint email_log_event_kind_check
  check (event_kind in (
    'assigned', 'checked_in', 'no_show', 'cancelled', 'expert_unavailable',
    'declined', 'waitlisted', 'event_cancelled', 'arrived_after_no_show',
    'double_booked', 'feedback_request', 'feedback_reminder', 'prep_reminder',
    'rematch_pending', 'unmatched_notice', 'reassigned_off', 'already_claimed',
    'day_of_agenda', 'unclaim_denied', 'slot_changed', 'prep_reminder_day_before',
    'cowork_only', 'guest_cancelled', 'prep_reminder_day_before_paid'
  ));

-- Once-only guard for the reminder dispatch (mirrors events.feedback_sent_at).
alter table events add column if not exists feedback_reminder_sent_at timestamptz;
comment on column events.feedback_reminder_sent_at is
  'When the 2-day post-event feedback reminder was dispatched (once). Null = not yet sent.';
