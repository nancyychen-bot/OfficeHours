-- Operator "archive a dashboard" flag. Shared Luma calendars (notion-master,
-- singapore, sydney) host non-Build-Bar events (AI Labs, Cincinnati dinners,
-- Notion 101…); those are hidden from dashboards by name (isOurEventName), but we
-- also need an explicit per-event hide for same-named dupes/tests and to make an
-- event fully inert (skipped by the comms/stats/readiness crons). Reversible.
--
-- Applied to remote via mcp apply_migration on 2026-10-21 (see list_migrations);
-- this file keeps the repo mirror in sync.
alter table public.events add column if not exists hidden boolean not null default false;
comment on column public.events.hidden is
  'Operator-archived: hidden from all hub dashboards + public embed, and skipped by comms/stats/readiness crons. Reversible. Non-Build-Bar events are also hidden from dashboards by name (isOurEventName), independent of this flag.';
