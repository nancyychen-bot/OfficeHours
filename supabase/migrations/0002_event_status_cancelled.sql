-- Add a 'cancelled' state for events that are called off (slots drop off boards).
alter type event_status add value if not exists 'cancelled';
