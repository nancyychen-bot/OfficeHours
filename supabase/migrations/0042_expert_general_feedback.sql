-- 0042_expert_general_feedback.sql
-- General feedback/learnings from an expert about an event (not tied to a guest).
-- One row per (event, expert). Synced one-way to the same Dev feedback Notion DB
-- as a "General"-typed page (Guest blank).
create table if not exists expert_general_feedback (
  event_id uuid not null references events(id) on delete cascade,
  expert_email text not null,
  expert_name text,
  note text,
  event_name text,
  event_date date,
  location text,
  notion_dev_page_id text,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, expert_email)
);
