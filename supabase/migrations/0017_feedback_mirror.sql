-- ============================================================================
-- 0017 — feedback_mirror: idempotency map for the feedback form enrichment.
-- Maps an Ambassador feedback page to its mirrored Dev page so a repeat webhook
-- updates the existing Dev row instead of creating a duplicate.
-- ============================================================================
create table if not exists feedback_mirror (
  ambassador_page_id text primary key,
  dev_page_id text,
  matched_event_id uuid references events(id) on delete set null,
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
