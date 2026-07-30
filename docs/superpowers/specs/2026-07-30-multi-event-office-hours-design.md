# Design: Multi-Event / Multi-City Office Hours

**Status:** Approved (brainstorm) — 2026-07-30
**Phase:** Operationalize the one Office Hours format across many cities/months on a
single shared Luma calendar, all in the one existing database.

## Goal

Let an organizer stand up a new Office Hours event (any city, month, language) in
well under 15 minutes, with slots that can never drift from the Luma form, while the
shared database stays clean despite unrelated events living on the same Luma calendar.

## Context / current state

- Data model already supports this: `events` (city, timezone, `luma_event_id`, status)
  → `slots` (per event) → `bookings`. Filtered views, not separate DBs (PRD §11).
- One Luma calendar holds Office Hours events **and** unrelated events (dinners, talks,
  hackathons). The single registered Luma webhook receives **every** registration on
  that calendar; unregistered events currently log as `error` ("no matching event").
- Bidirectional Notion sync (claim/unclaim) is live and verified.
- Onboarding an event today = manual SQL/REST inserts (not scalable).

## Decisions (from brainstorm)

1. **Scope = one format across cities** (homogeneous Office Hours), not many event types.
2. **Allowlist by explicit registration** — only events an organizer registers are ever
   acted on. Chosen over naming-convention because the name changes and is localized
   (e.g. Japanese), so titles are not a reliable signal.
3. **Register-by-Luma-link with auto-pull** — the hub fetches event details + slot
   options from Luma; the organizer supplies only the link, city, and slot start/length.
4. **Slots: labels from Luma, times from organizer** — slot *names* come verbatim from
   the Luma dropdown (localization-proof, matching-proof); slot *times* are computed from
   a start-time + fixed length + option order (slots are a contiguous equal-length run).
5. **No-show grace = 15 minutes after slot end.**

## Non-goals (deferred to the admin-UI phase)

- Cross-market rollup / metrics dashboard.
- Check-in → helper notification (native Notion "notify person").
- Guest-initiated cancellation handling (guest declines in Luma).

---

## Section 1 — Event registration

**Function:** `registerEventFromLuma(input)` in a new `lib/events/register.ts`, exposed
as `npm run register:event` (CLI now; becomes a one-field admin screen later — same
function).

**Inputs:**
- `lumaEvent` — Luma event link or id (accepts full URL or `evt-…`).
- `city` — explicit (Luma has no clean city field; names/languages vary).
- `slotStart` — first slot start (date+time, interpreted in the event's timezone).
- `slotLengthMinutes` — default 30.

**Steps:**
1. Resolve the Luma event id from the input; call Luma `GET /v1/event/get?api_id=<id>`
   → read `name`, `start_at`, `timezone`.
2. Upsert the `events` row (match on `luma_event_id`): name, city, event_date (from
   `start_at` in event tz), timezone, status = `planned`. Idempotent — re-running updates
   in place.
3. Read `registration_questions`; select the **slot dropdown** question:
   - If exactly one dropdown, use it.
   - If multiple, prefer one whose label matches a slot/time hint; print the chosen
     question + detected options for confirmation before committing.
4. For each dropdown option **in order** (index `i`), generate a `slots` row:
   - `name` = the option label **verbatim** (any language).
   - `starts_at` = `slotStart + i * slotLengthMinutes` (in event tz → stored tz-aware).
   - `ends_at` = `starts_at + slotLengthMinutes`.
   - Idempotent: re-running replaces the event's generated slots to match the current
     dropdown (bookings reference slots via `on delete set null`, so re-generation must
     preserve still-valid slots by name — match existing slot by name, update times;
     add new; remove ones no longer offered that have no booking).

**Why labels-from-Luma + times-from-organizer:** matching a booking to a slot is done by
label (opaque, localization-proof — kills the earlier "dropdown must match our names"
problem); times, needed for ordering + the no-show sweep, come from a single
start+interval since slots are a contiguous equal-length run.

**Pure, testable core:** `generateSlotsFromOptions(labels[], slotStart, lengthMin, tz)`
→ `{name, starts_at, ends_at}[]`. Unit-tested independent of Luma/DB.

---

## Section 2 — Keeping the shared database clean

**Allowlist enforcement at the webhook.** Change the Luma handler: a webhook whose
`data.event.id` is not in `events` is logged as `ignored` (result, info-level), returns
200, and does nothing else. Unrelated events (dinners/talks) fall on the floor quietly;
the sync log stays meaningful. (Today this path logs `error` — just a result/label change.)

**Notion views (organizer-created, per event).** The organizer creates a filtered
linked view of the Bookings database on a page for each event — filtered to
`Status = Unassigned`, `Location = <that city>`, and the event's date — and shares that
page with the people who book. So the hub ships **no views guide**; its responsibility is
to guarantee the filter properties are always present and correctly populated on every
booking.

That requires **adding two properties** the hub pushes (today it only pushes `Location`
and `Slot`, so two SF events in different months are indistinguishable):
- **`Event`** — the event name (e.g. "Office Hours — SF — Aug 2026"); uniquely identifies
  an event in one filter.
- **`Event date`** — a Notion **date** property, so per-event views can filter by date.

Both are added to the Bookings data-source schema in each workspace (extending the
existing alignment step) and populated on every push from the booking's event. New cities
need no pre-config — the `Location` select option is auto-created when the hub first
writes a booking for that city (integration has write access; Notion auto-adds options).

---

## Section 3 — Lifecycle & operations

**Event status.** `planned → live → completed` (add `cancelled` to the `event_status`
enum via migration). Registration creates `planned`; organizer flips `live` around the
event and `completed`/`cancelled` after. Active views filter to upcoming/non-completed so
boards show only what's actionable; bookings are retained for reporting.

**Automated no-show sweep.** `markNoShowsForEndedSlots` exists but is uncalled. Add a
Vercel Cron (every 15 min) hitting a protected endpoint `POST /api/cron/no-show` (shared
secret via header). It flips any booking whose slot ended **> 15 minutes ago** and is not
`Checked In` to `No-show`, then mirrors that status to Notion. Grace period is a constant
(`NO_SHOW_GRACE_MINUTES = 15`), based on slot **end** time.

**Timezones.** Handled in registration — slot times computed in the event's own tz
(from Luma), stored tz-aware. A Tokyo event's slots are correct with no special-casing.

**Editing / cancelling.** Form changed → re-run `register:event` (idempotent). Event
cancelled → mark `cancelled`; its slots drop off active boards.

---

## Components touched

| Area | Change |
|---|---|
| `lib/luma/client.ts` | add `getEvent(id)` (Luma `GET /v1/event/get`) + registration-questions read |
| `lib/events/register.ts` (new) | `registerEventFromLuma` + pure `generateSlotsFromOptions` |
| `scripts/register-event.ts` (new) | CLI wrapper → `npm run register:event` |
| `app/api/webhooks/luma/route.ts` | unregistered event → `ignored` (not error) |
| `app/api/cron/no-show/route.ts` (new) | protected endpoint calling the sweep |
| `lib/db/bookings.ts` | no-show sweep honors 15-min grace after slot end |
| `supabase/migrations/` | add `cancelled` to `event_status` enum |
| `lib/notion/schema.ts` + alignment | add `Event` (rich_text) + `Event date` (date) properties to both Bookings data sources |
| `lib/notion/mappers.ts` | populate `Event` (name) + `Event date` on the initial page push (`bookingToPageProperties`) |
| `vercel.json` / config | Cron schedule for the no-show sweep |

## Testing

- `generateSlotsFromOptions` — order, times, length, tz, localized labels (pure unit).
- Slot re-generation idempotency — preserves booked slots by name, adds/removes correctly.
- No-show grace — a slot ended 10 min ago is NOT swept; 20 min ago IS.
- Allowlist — a webhook for an unregistered event id creates no booking and logs `ignored`.

## Success criteria

- New city onboarded in < 15 min (one command).
- Slots always match the Luma dropdown by construction (no manual matching).
- Unrelated calendar events never create bookings.
- No-shows flip exactly 15 min after slot end, automatically, across all events.
