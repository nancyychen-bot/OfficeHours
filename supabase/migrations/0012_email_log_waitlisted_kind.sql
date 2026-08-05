-- ============================================================================
-- 0012 — Allow the `waitlisted` comms kind in email_log
-- Waitlisting a guest now sends a hub "you're on the waitlist" email.
-- ============================================================================
alter table email_log drop constraint email_log_event_kind_check;
alter table email_log add constraint email_log_event_kind_check
  check (event_kind in ('assigned', 'checked_in', 'no_show', 'cancelled', 'expert_unavailable', 'declined', 'waitlisted'));
