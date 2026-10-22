-- 0059 — complete_registration comms kind
-- Adds the new kind to the email_log CHECK constraint so reserve() can INSERT rows.
-- Migration number chosen as remote max (events_form_anomalies = 20261008005321) + 1.
alter table public.email_log drop constraint email_log_event_kind_check;
alter table public.email_log add constraint email_log_event_kind_check check (
  event_kind = any (array[
    'assigned','checked_in','no_show','cancelled','expert_unavailable','declined',
    'waitlisted','event_cancelled','arrived_after_no_show','double_booked',
    'feedback_request','feedback_reminder','prep_reminder','rematch_pending',
    'unmatched_notice','reassigned_off','already_claimed','day_of_agenda',
    'unclaim_denied','slot_changed','prep_reminder_day_before','cowork_only',
    'guest_cancelled','prep_reminder_day_before_paid','cowork_only_accept',
    'complete_registration'
  ])
);
