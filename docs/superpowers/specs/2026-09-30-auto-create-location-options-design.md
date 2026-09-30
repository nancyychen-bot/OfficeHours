# Auto-create Notion "Location" dropdown options at event registration

**Date:** 2026-09-30
**Status:** Approved (design)

## Problem

The `Location` property on the Notion booking databases (Dev + Ambassador) is a
`select`. Notion only creates a select *option* when a page is written with that
value. Booking pages are written per-registrant (`lib/events/ingest.ts`), so a
city's option doesn't exist until its **first registrant** is ingested.

Result: an event can be fully registered (row in `events` with a valid `city`)
yet be **unfilterable** in Notion because its city isn't an option in the
`Location` dropdown. As of 2026-09-30 this affects **Singapore** (had to be added
manually) and **London** (event exists, 0 bookings, still missing).

## Goal

Create the `Location` select option as soon as an event is registered — not when
the first person books — and backfill options for events already in the DB.

## Non-goals (explicitly out of scope)

- Fixing the **"Chippendale" vs "Sydney"** naming (a `cityFromGeo` suburb-level
  issue tracked in the multi-city pre-scaling audit). This feature writes
  `event.city` verbatim; it does not normalize it.
- Cleaning up existing junk options ("Test City", "Chippendale"). This feature is
  **additive only** — it never removes or renames options.
- Any change to how bookings are written or synced.

## Design

### New module — `lib/notion/location-options.ts`

```
mergeLocationOptions(existing: Array<{id?, name, color?}>, city: string)
  → Array<option> | null
```
Pure function. Returns a new options array (`[...existing, { name: city }]`) when
`city` is not already present (exact match after trimming); returns `null` when it
already exists. Existing options are passed through untouched (ids/colors
preserved) so an update never drops or recolors them. This is the unit under test.

```
ensureLocationOption(city: string): Promise<void>
```
For each workspace in `["dev", "ambassador"]`:
1. `getNotionClient(workspace)` + `bookingsDataSourceId(workspace)`.
2. Retrieve the data source, read the current `Location` (`PROP.location`) select
   options.
3. `mergeLocationOptions(current, city)`. If `null`, skip (already present).
4. Else `dataSources.update({ data_source_id, properties: { [PROP.location]:
   { select: { options: merged } } } })`.

Per-workspace `try/catch` that logs and continues — a failure in one workspace
must not block the other. Idempotent.

### Hook — `lib/events/register.ts`

After the `upsertEvent(...)` call (~line 119), where `city` is already resolved:

```ts
try {
  await ensureLocationOption(city);
} catch (err) {
  console.error("[register] ensureLocationOption failed", err);
}
```

Best-effort, mirroring the existing guest-backfill block. A registration must
never fail because Notion schema patching hiccupped. Covers both the add-event
form and the registration script, since both go through `registerEventFromLuma`.

### Backfill — `scripts/sync-location-options.ts` (+ `npm run sync:location-options`)

Query `select distinct city from events where city is not null`, then call
`ensureLocationOption(city)` for each. Idempotent; safe to re-run. Running it once
adds **London** (and any other option-less city) immediately.

## Data flow

```
add-event form / register script
  → registerEventFromLuma()
      → upsertEvent()               (events.city set)
      → ensureLocationOption(city)  (best-effort)
          → for dev, ambassador:
              retrieve data source → mergeLocationOptions → dataSources.update
```

Backfill path: `sync:location-options` → distinct event cities → same
`ensureLocationOption`.

## Error handling

- Registration path: swallow + log (never fail a registration).
- Backfill script: log per-city failures, continue, exit non-zero if any failed
  so the run is visibly incomplete.
- `ensureLocationOption`: per-workspace isolation via try/catch.

## Testing (TDD)

- `mergeLocationOptions` unit tests:
  - appends `{ name: city }` when the city is absent
  - returns `null` when the city is already present (exact match)
  - trims whitespace before comparing
  - preserves existing options (ids/colors) in the returned array
- The Notion-hitting `ensureLocationOption` stays a thin shell over the pure
  function; no live Notion calls in tests.

## Notion API notes

- SDK `@notionhq/client` `^5.23.3`, API version `2025-09-03`.
- Editable property schema lives on the **data source**, not the database — use
  `dataSources.update`, not `databases.update` (see
  `scripts/configure-expert-feedback-db.ts` header comment and
  `scripts/rebuild-notion-schema.ts`).
- Select option names must not contain commas; `cityFromGeo` already splits on
  comma, so stored `event.city` values are safe.
