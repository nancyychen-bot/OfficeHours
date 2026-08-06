-- Set when we post a "cover this 1:1" recruit message to Slack (unclaim/release).
-- When the slot is next claimed, we post a "covered" follow-up to that channel
-- and clear this — so the channel only ever gets a "covered" note for slots it
-- was actually asked to cover (not every first-time claim).
alter table bookings
  add column if not exists slack_recruit_posted_at timestamptz;
