-- Per-city Slack incoming webhooks. When a 1:1 slot opens up (unclaim/release),
-- we post a "recruit a replacement" message to that city's channel. One row per
-- city; the webhook URL is a secret (service-role access only). City is matched
-- case-insensitively against events.city.
create table if not exists slack_channels (
  city text primary key,
  channel_name text,
  webhook_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
