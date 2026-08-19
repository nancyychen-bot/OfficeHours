-- Track the two recruit-reminder stages per booking (null = not yet sent).
-- r1 = "3 days after first recruit post"; r2 = "2 days before the event".
alter table bookings
  add column slack_recruit_r1_at timestamptz,
  add column slack_recruit_r2_at timestamptz;
