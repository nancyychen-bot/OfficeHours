-- Harden the email_log ledger with value constraints. `pending` is the
-- reservation state written before a send attempt (see reserveCommsSlot); the
-- terminal states are sent / failed / skipped (failed & skipped are retryable).
alter table email_log
  add constraint email_log_status_check
    check (status in ('pending', 'sent', 'failed', 'skipped'));

alter table email_log
  add constraint email_log_event_kind_check
    check (event_kind in ('assigned', 'checked_in', 'no_show'));

alter table email_log
  add constraint email_log_recipient_role_check
    check (recipient_role in ('helper', 'guest'));
