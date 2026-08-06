-- Remove the unused, unenforced slots.capacity column. Since 0015 (multiple
-- bookings per slot), capacity is advisory-only and nothing reads it — but it
-- still reads "1", which misleads anyone who sees it. Concurrency is bounded by
-- how many experts claim, not a per-slot cap. Dropping the column also drops its
-- dependent CHECK constraint (slots_capacity_positive) automatically.
alter table slots drop column if exists capacity;
