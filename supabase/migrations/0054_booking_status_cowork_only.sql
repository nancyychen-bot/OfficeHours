-- Add the "Cowork only" assignment status: an organizer accepts an unclaimed
-- 1:1 registrant for coworking when no volunteer claimed them (no 1:1 match).
-- Behaves as a sibling of no_help_needed ("attending, no 1:1"), but is a distinct,
-- separately-reportable state and drives the cowork-only acceptance email.
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'cowork_only';
