-- 0038_expert_feedback.sql
-- Expert-facing post-event feedback, one row per 1:1 (booking). One-way synced to a
-- Dev Notion database. Rows are created (answers null) when the feedback DM is sent;
-- the presence of rows for an (event_id, expert_email) means "already prompted".
create table if not exists expert_feedback (
  booking_id uuid primary key references bookings(id) on delete cascade,
  event_id uuid references events(id) on delete set null,
  expert_email text not null,
  expert_name text,
  guest_name text,
  guest_email text,
  attended boolean,
  rating int check (rating between 1 and 5),
  note text,
  responded_at timestamptz,
  notion_dev_page_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expert_feedback_event_expert_idx
  on expert_feedback (event_id, lower(expert_email));
