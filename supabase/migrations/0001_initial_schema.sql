-- ============================================================================
-- Notion Office Hours — Source-of-Truth Schema (Hub)
-- ============================================================================
-- This is the app-owned single source of truth described in PRD §7.2.
-- It is NOT a Notion database. Both Notion workspaces (Notion Dev + Ambassador)
-- and Luma are synced against these tables by the hub.
--
-- Data model per PRD §6: one hub, three related tables (Events -> Slots -> Bookings).
-- Slots are real rows (not a text field) so "show unassigned" is a filter and
-- slot collisions are prevented structurally (PRD §6.2).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type event_status  as enum ('planned', 'live', 'completed');
create type booking_status as enum ('unassigned', 'assigned', 'checked_in', 'no_show');
create type booked_by_type as enum ('employee', 'ambassador');

-- Which "leg" a sync record came from / went to (for the sync_log, PRD §7.3/§13).
create type sync_direction as enum (
  'luma_in',        -- webhook from Luma
  'notion_dev_in',  -- automation webhook from Notion Dev workspace
  'notion_amb_in',  -- automation webhook from Ambassador workspace
  'hub_to_dev',     -- hub PATCH -> Notion Dev
  'hub_to_amb'      -- hub PATCH -> Ambassador workspace
);

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = ''   -- hardening: avoid role-mutable search_path (Supabase linter 0011)
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- events — one row per city/month session (PRD §6.1)
-- ---------------------------------------------------------------------------
create table events (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                       -- "Office Hours — SF — Aug 2026"
  city          text not null,                       -- SF, NYC, Tokyo, London, ...
  event_date    date not null,
  timezone      text not null default 'America/Los_Angeles',
  status        event_status not null default 'planned',
  -- Join key so the hub can match a Luma webhook payload to the right event
  -- without any manual per-event mapping (PRD §11).
  luma_event_id text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index events_city_idx   on events (city);
create index events_date_idx   on events (event_date);
create index events_status_idx on events (status);

create trigger events_set_updated_at
  before update on events
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- slots — one bookable 30-min window per event (PRD §6.2)
-- ---------------------------------------------------------------------------
create table slots (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events (id) on delete cascade,
  name       text not null,                          -- "2:00–2:30 PM"
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  capacity   integer not null default 1,             -- future-proofing only (PRD §6.2)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint slots_end_after_start check (ends_at > starts_at),
  constraint slots_capacity_positive check (capacity >= 1)
);

create index slots_event_idx  on slots (event_id);
create index slots_starts_idx on slots (starts_at);

create trigger slots_set_updated_at
  before update on slots
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- bookings — the record synced across workspaces, one row per guest (PRD §6.3)
-- ---------------------------------------------------------------------------
-- NOTE ON PERSON FIELDS (PRD §6.3): the two native Notion "Person" fields
-- (Booked by – internal / Booked by – ambassador) intentionally DO NOT live
-- here. They only resolve inside their own workspace. The hub only ever knows
-- the plain-text mirror (booked_by_display_name) + role tag (booked_by_type),
-- which is the only thing that crosses the sync boundary.
create table bookings (
  id           uuid primary key default gen_random_uuid(),

  -- Event is denormalized onto the booking so a registration always ties to an
  -- event even if its requested slot can't be matched yet (see slot_id below).
  event_id     uuid not null references events (id) on delete restrict,
  -- 0-or-1 slot per booking. Partial unique index below enforces one guest per
  -- slot (capacity 1 today) — this is the structural dedupe from PRD §6.2.
  slot_id      uuid references slots (id) on delete set null,

  -- Guest fields (from Luma registration, PRD §5)
  guest_name   text not null,
  guest_email  text not null,                        -- join key back to Luma (PRD §6.3)
  guest_phone  text,                                 -- EU privacy handling, PRD §6.3/§12
  role         text,
  company      text,
  challenge    text,

  -- Workflow state — drives every downstream view and automation (PRD §6.3)
  status                 booking_status not null default 'unassigned',
  booked_by_display_name text,                       -- cross-boundary text mirror
  booked_by_type         booked_by_type,             -- Employee / Ambassador

  -- Luma join key for webhook updates (registration edits, check-in) — PRD §7.3
  luma_guest_id text unique,

  -- Notion page IDs so the hub can PATCH the correct mirrored page in each
  -- workspace (PRD §7.3 outbound). Populated when the hub first pushes the row.
  notion_dev_page_id        text unique,
  notion_ambassador_page_id text unique,

  -- Loop prevention (PRD §7.3): the hub stamps every write it makes with a
  -- hash of the synced fields; inbound webhooks are compared against this to
  -- distinguish a real human change from an echo of the hub's own write.
  last_synced_hash text,
  last_synced_at   timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One booking per slot while capacity = 1 (structural collision prevention).
-- Lift/replace this alongside `capacity` if group slots are ever supported.
create unique index bookings_one_per_slot
  on bookings (slot_id)
  where slot_id is not null;

create index bookings_event_idx  on bookings (event_id);
create index bookings_status_idx on bookings (status);
create index bookings_email_idx  on bookings (lower(guest_email));

create trigger bookings_set_updated_at
  before update on bookings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- sync_log — append-only audit trail for debugging the sync engine
-- (PRD §7.3 "one place to debounce echoes", §13 "resolve sync issues")
-- ---------------------------------------------------------------------------
create table sync_log (
  id         bigint generated always as identity primary key,
  direction  sync_direction not null,
  booking_id uuid references bookings (id) on delete set null,
  action     text,                                   -- e.g. 'create','status_change','check_in'
  result     text not null,                          -- 'applied' | 'skipped_echo' | 'error'
  payload    jsonb,                                  -- raw inbound/outbound payload
  note       text,
  created_at timestamptz not null default now()
);

create index sync_log_booking_idx on sync_log (booking_id);
create index sync_log_created_idx  on sync_log (created_at desc);

-- ---------------------------------------------------------------------------
-- booking_details — convenience view resolving the Location rollup
-- (PRD §6.3 "Location: Rollup from Slot -> Event -> City") plus slot times.
-- ---------------------------------------------------------------------------
create view booking_details as
select
  b.*,
  e.city         as location,
  e.name         as event_name,
  e.event_date,
  e.timezone,
  s.name         as slot_name,
  s.starts_at    as slot_starts_at,
  s.ends_at      as slot_ends_at
from bookings b
join events e on e.id = b.event_id
left join slots s on s.id = b.slot_id;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- The hub accesses these tables server-side with the service-role key, which
-- bypasses RLS. We enable RLS with NO policies so nothing is reachable via the
-- anon/public key. Add scoped policies later only if a client ever needs
-- direct access.
alter table events   enable row level security;
alter table slots    enable row level security;
alter table bookings enable row level security;
alter table sync_log enable row level security;
