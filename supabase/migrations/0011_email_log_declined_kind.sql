-- ============================================================================
-- 0011 — Allow the `declined` comms kind in email_log
-- Declines now send a hub-owned "at capacity" email to the guest (any decline,
-- assigned or not), so email_log must accept the new event_kind.
-- ============================================================================
alter table email_log drop constraint email_log_event_kind_check;
alter table email_log add constraint email_log_event_kind_check
  check (event_kind in ('assigned', 'checked_in', 'no_show', 'cancelled', 'expert_unavailable', 'declined'));
