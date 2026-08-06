# Results Dashboard v2 — Design Spec

**Date:** 2026-08-05
**Status:** Approved → implement

## Goal

Turn the results page from raw counts into a decision tool: a glanceable KPI band,
per-event deep dives (attendance, 1:1 coverage, satisfaction distribution,
**confidence lift**, interests, verbatim comments), and cross-event community
insight (**repeat attendance**). Attendance numbers come from an authoritative
**Luma stats sync**.

## Data additions

### Luma stats sync (migration 0022)
`events` gains `luma_stats jsonb` + `luma_synced_at timestamptz`. Shape:
`{ registered, approved, checkedIn, waitlist, capacity }` (numbers, nullable).

- `lib/luma/client.ts` → `fetchEventStats(eventLumaId)`: pages `listEventGuests`,
  tallies by approval status + checked-in; capacity/waitlist from event detail.
- `lib/events/luma-stats.ts` → `syncLumaStatsForEvent(event)` + `syncAllLumaStats()`.
- Cron `app/api/cron/luma-stats/route.ts` (every 15 min) syncs non-cancelled events;
  manual `npm run sync:luma-stats`. Best-effort, cron-secret guarded.

Types: add `luma_stats` (Json) + `luma_synced_at` to the generated `events` type.

## Aggregation (`lib/hub/results.ts`, all pure + unit-tested)

`computeResults(bookings, feedback, events)` returns `{ overall, perEvent }` where
each `EventResult` now also includes:

- **Attendance**: prefer `event.luma_stats` (registered/approved/checkedIn/waitlist);
  fall back to booking-derived counts when stats are absent. Keep no-show from bookings.
- **1:1 coverage**: requested / claimed / completed / **unmet** (requested − claimed).
- **Satisfaction**: avg + **distribution** `{1..5: count}`.
- **Confidence lift**: counts per bucket (Much more / Somewhat more / Same / Less /
  Unknown) + `pctMoreConfident` = (much+somewhat) ÷ answered.
- **Interests**: `Array<{ label, count }>` sorted desc.
- **Comments**: `Array<{ guestName, featureIntent, highlight }>` (non-empty only).

New cross-event helper `computeCommunity(bookings)`:
- **Repeat attendance**: group `checked_in` bookings by lowercased email; a repeat
  attendee has ≥2 distinct events. Returns `{ uniqueAttendees, repeatAttendees,
  repeatRate, top: Array<{ email, name, events } > }`.

## Queries (`lib/hub/queries.ts`)

- `HubEvent` gains `luma_stats` + `luma_synced_at`; `listEvents()` selects them.
- Feedback already carries confidence/interests/feature_intent/highlight.

## UI

- **KPI band** (`components/hub/KpiBand.tsx`): Events · Registered · Attended (rate) ·
  1:1s completed · Avg satisfaction · % more confident · Repeat-attendee rate ·
  Feedback response rate. Rendered above the tabs on `/results`.
- **Per-event card** (extend `ResultsTab`): add satisfaction distribution bar,
  confidence stacked bar with "% left more confident", interests bars, and a
  "Voice of the attendee" list (feature-intent + comments). Keep event tabs.
- **Community section**: repeat-attendance stat + short list, shown under the
  "All events" tab.
- Reuse the colored-tile / progress-bar visual language already added.

## Testing

Unit tests: attendance prefers luma_stats then falls back; 1:1 unmet; satisfaction
distribution; confidence pctMoreConfident + divide-by-zero; interests tally sort;
repeat-attendance (same email across 2 events = repeat; single event = not).

## Notes

- Luma stats are best-effort; if a sync hasn't run, the funnel falls back to the
  mirror so the page never breaks.
- Confidence + interests were previously out of scope for the dashboard; this v2
  brings them in as insight modules.
