-- Idempotency ledger for hub-sent booking comms. One row per
-- (booking, event_kind, recipient_role); the unique index is the hard backstop
-- against webhook retries / cron re-runs double-sending.
create table if not exists email_log (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null references bookings(id) on delete cascade,
  event_kind     text not null,   -- 'assigned' | 'checked_in' | 'no_show'
  recipient_role text not null,   -- 'helper' | 'guest'
  recipient_email text not null,
  resend_id      text,            -- null when failed/skipped
  status         text not null,   -- 'sent' | 'failed' | 'skipped'
  created_at     timestamptz not null default now(),
  unique (booking_id, event_kind, recipient_role)
);

alter table email_log enable row level security;  -- service-role only, no policies
