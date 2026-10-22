-- Canonical city registry for per-city comms customization (SP1). Maps messy
-- free-text events.city + the luma_calendar tag to a stable city slug + locale.
-- Applied to remote via mcp apply_migration on 2026-10-21 (see list_migrations).

create table if not exists public.cities (
  slug text primary key,
  name text not null,
  locale text not null default 'en',
  luma_calendar text,
  aliases text[] not null default '{}'
);
alter table public.cities enable row level security;

insert into public.cities (slug, name, locale, luma_calendar, aliases) values
  ('seoul',     'Seoul',         'ko', 'korea',         '{}'),
  ('sydney',    'Sydney',        'en', 'sydney',        '{"Chippendale","Ultimo"}'),
  ('singapore', 'Singapore',     'en', 'singapore',     '{}'),
  ('london',    'London',        'en', 'london',        '{}'),
  ('nyc',       'New York',      'en', 'notion-master', '{"NYC"}'),
  ('sf',        'San Francisco', 'en', 'notion-master', '{"SF"}')
on conflict (slug) do nothing;
