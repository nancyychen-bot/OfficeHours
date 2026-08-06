-- ============================================================================
-- 0015 — Allow multiple guests per time slot (one per available Notion expert)
-- The one-guest-per-slot unique index blocked popular times when several experts
-- were working. Drop it; concurrency is now bounded naturally by how many experts
-- claim. (The `capacity` column is left in place, advisory/unused.)
-- ============================================================================
drop index if exists bookings_one_per_slot;
