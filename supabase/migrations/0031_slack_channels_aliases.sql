-- Cities can arrive from Luma's geocoded address under several names (e.g. a
-- Brooklyn/Manhattan venue). `aliases` lets one channel match any of them, so
-- routing doesn't depend on an exact `events.city` string. Matching is against
-- `city` OR any `alias`, case-insensitive.
alter table slack_channels
  add column if not exists aliases text[] not null default '{}';
