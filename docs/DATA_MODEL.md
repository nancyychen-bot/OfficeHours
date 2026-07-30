# Data Model — Source of Truth (Hub)

Implements PRD §6. This is the **app-owned Postgres source of truth** (PRD §7.2),
not a Notion database. Migration: `supabase/migrations/0001_initial_schema.sql`.

## Tables

| Table | Purpose |
|---|---|
| `events` | One row per city/month session. Holds `luma_event_id` so webhooks route to the right event. |
| `slots` | One bookable 30-min window per event. Real rows → "show unassigned" is a filter, collisions prevented structurally. |
| `bookings` | One row per guest — the record mirrored into both Notion workspaces. |
| `sync_log` | Append-only audit trail for debugging the sync engine. |
| `booking_details` (view) | Resolves the `Location` rollup (city) + slot times for convenient reads. |

## Decisions worth knowing

1. **The two Notion `Person` fields are NOT in this schema.** Per PRD §6.3 they only
   resolve inside their own workspace. The hub stores only `booked_by_display_name`
   (text) + `booked_by_type` (employee/ambassador) — the only things that cross the
   sync boundary.

2. **`bookings.slot_id` is nullable** so a Luma registration is never lost if its
   requested slot can't be matched. `event_id` is denormalized onto the booking so a
   record always ties to an event regardless.

3. **One booking per slot** is enforced by a partial unique index
   (`bookings_one_per_slot`). This is the structural dedupe promised in PRD §6.2. It
   pairs with `slots.capacity` (currently always 1); lift both together if group slots
   are ever supported.

4. **Loop prevention** lives on `bookings.last_synced_hash` (PRD §7.3). The hub hashes
   the synced fields on every write; inbound webhooks compare against it to tell a real
   human change from an echo of the hub's own write.

5. **Notion page IDs** (`notion_dev_page_id`, `notion_ambassador_page_id`) let the hub
   PATCH the correct mirrored page in each workspace. Populated on first push.

6. **RLS enabled, no policies.** The hub uses the service-role key (bypasses RLS); the
   anon key can't reach anything.

## Open schema-touching questions (from PRD §13)

- **Registration edits** (guest changes requested slot after submit): the schema
  supports re-pointing `slot_id`; the *reconciliation policy* is app logic, TBD.
- **Ambassador-as-guest de-dup by email**: `guest_email` is indexed
  (case-insensitive) to make this cheap later; no unique constraint yet since the
  same email could legitimately have bookings across different events.
- **EU/GDPR**: `guest_phone` / `challenge` may be withheld from one workspace's
  mirror — that's a sync-push decision, not a schema change.
