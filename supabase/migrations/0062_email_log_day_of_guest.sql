-- The day-of guest reminder (morning-of email telling each claimed-1:1 guest
-- their slot + expert) ships a new `day_of_guest` comms kind in code
-- (lib/email/templates.ts, lib/email/comms.ts, lib/events/day-of-guest.ts).
-- Like every new kind, email_log's CHECK constraint must allow it — otherwise the
-- reserve INSERT throws ("violates check constraint email_log_event_kind_check")
-- and the email silently fails (no email_log row; logged under sync_log).
--
-- Applied to remote via mcp apply_migration on 2026-10-22 (see list_migrations);
-- this file keeps the repo mirror in sync. Full value list = the live constraint
-- (incl. complete_registration + reapproved) plus day_of_guest.
alter table public.email_log drop constraint email_log_event_kind_check;
alter table public.email_log add constraint email_log_event_kind_check check (
  event_kind = any (array[
    'assigned','checked_in','no_show','cancelled','expert_unavailable','declined',
    'waitlisted','event_cancelled','arrived_after_no_show','double_booked',
    'feedback_request','feedback_reminder','prep_reminder','rematch_pending',
    'unmatched_notice','reassigned_off','already_claimed','day_of_agenda','day_of_guest',
    'unclaim_denied','slot_changed','prep_reminder_day_before','cowork_only',
    'guest_cancelled','prep_reminder_day_before_paid','cowork_only_accept',
    'complete_registration','reapproved'
  ])
);
