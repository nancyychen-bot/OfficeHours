-- Expert feedback: 18h "don't forget" reminder nudge support.
-- reminder_sent_at guards the once-per-(event,expert) nudge (set when the reminder
-- DM is sent). Backfill existing rows so the new cron never nudges historical
-- feedback — only prompts created after this migration become eligible.
alter table public.expert_feedback add column if not exists reminder_sent_at timestamptz;

update public.expert_feedback set reminder_sent_at = now() where reminder_sent_at is null;
