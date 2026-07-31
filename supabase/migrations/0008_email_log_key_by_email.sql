-- Re-key comms idempotency on recipient EMAIL instead of role, so re-assigning a
-- booking to a DIFFERENT helper notifies the new helper (new email -> new send),
-- while the same helper re-claiming and the guest never get duplicates.
alter table email_log
  drop constraint if exists email_log_booking_id_event_kind_recipient_role_key;

alter table email_log
  add constraint email_log_booking_kind_email_key
    unique (booking_id, event_kind, recipient_email);
