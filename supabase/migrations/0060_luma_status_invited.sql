-- 0060 — add 'invited' to the luma_status enum (host-invited, pre-acceptance guests).
-- Maps Luma approval_status "invited"; kept distinct from 'pending' so the
-- day-before decline sweep (which targets pending) never auto-declines them.
alter type luma_status add value if not exists 'invited';
