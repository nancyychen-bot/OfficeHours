-- ============================================================================
-- 0053 — Per-event prep-email instructions.
-- Free-form logistics (check-in, where to go, parking…) shown in the three
-- prep-reminder emails for THIS event only. Keyed on the event row, so one
-- city's instructions can never leak into another city's email. Null/empty ⇒
-- no block (the default, and today's exact email).
-- ============================================================================
alter table events add column if not exists prep_instructions text;

comment on column events.prep_instructions is
  'Per-event free-form logistics shown in prep-reminder emails (check-in, where to go). Null/empty = none. Edited from /readiness.';
