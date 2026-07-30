-- A booking that was approved then declined/cancelled (kept for reporting).
alter type booking_status add value if not exists 'cancelled';
