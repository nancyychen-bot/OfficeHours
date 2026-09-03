-- 0051_luma_calendars_calendar_id_unique.sql
-- Backstop the slug-collision / concurrent-duplicate race: a Luma calendar
-- (cal-… id) may map to at most one registry row. Partial (WHERE not null) so
-- rows without a resolved calendar_id don't collide on NULL.
create unique index if not exists luma_calendars_calendar_id_uniq
  on public.luma_calendars (calendar_id)
  where calendar_id is not null;
