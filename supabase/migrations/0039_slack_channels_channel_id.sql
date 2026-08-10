-- 0039_slack_channels_channel_id.sql
-- Bot posting (chat.postMessage) targets a channel id; when present it is
-- preferred over the incoming webhook. Nullable so webhook-only cities still work.
alter table slack_channels add column if not exists channel_id text;
