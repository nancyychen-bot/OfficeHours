# Hub: enriched bookings + feedback page + results dashboard — Design Spec

**Date:** 2026-08-05
**Status:** Approved design → ready for implementation plan

## Goal

Extend the Vercel hub (office-hours-three.vercel.app) with: (1) all the robust
booking fields on the bookings view, (2) a Feedback page listing form responses,
(3) a Results dashboard aggregating attendance/RSVP + 1:1 coverage + satisfaction
per event and overall.

## Architecture

Next.js App Router hub (behind existing login/middleware) reading Supabase. Feedback
answers are persisted to Supabase by the existing feedback webhook, so all three
pages read from Supabase (no live Notion calls on page load).

## 1. Data model

Extend **`feedback_mirror`** (migration `0021_feedback_content.sql`) with response
content:

```sql
alter table feedback_mirror
  add column if not exists guest_name text,
  add column if not exists guest_email text,
  add column if not exists satisfaction_score int,
  add column if not exists satisfaction_label text,
  add column if not exists confidence text,
  add column if not exists interests text[],
  add column if not exists feature_intent text,
  add column if not exists highlight text,
  add column if not exists notion_expert text,
  add column if not exists submitted_at timestamptz;
```

Regenerate Supabase types.

The **feedback webhook** (`app/api/webhooks/notion/feedback/route.ts`) already
runs per response; it will additionally read these fields off the Notion page and
pass them to `upsertFeedbackMirror`, which stores them. New readers in
`lib/notion/feedback.ts`: `readRichTextProp(props, name)`, `readMultiSelect(props, name)`,
`readSelectName(props, name)`. Idempotent (upsert on `ambassador_page_id`).

## 2. Navigation

A small nav component (`components/hub/HubNav.tsx`) rendered on each page:
**Bookings · Feedback · Results** (links to `/`, `/feedback`, `/results`), plus the
existing "+ Add event" / "Refresh". All behind the current middleware auth.

## 3. Bookings page (`/`)

Enrich `HubBooking` + `listBookings()` (in `lib/hub/queries.ts`) and `BookingsTab`
with the fields we've added: `luma_status`, `notion_email`, `notion_plan`,
`experience_level`, `attend_reasons`, `requested_slot`, `guest_phone`,
`booked_by_email`, `role`. Luma Status shown as a pill; denser intake fields shown
as columns (kept readable — secondary fields can be truncated/tooltip).

## 4. Feedback page (`/feedback`)

`app/feedback/page.tsx` + `components/hub/FeedbackTab.tsx`. Reads
`listFeedback()` from `feedback_mirror` joined to events. Columns: Name · Event ·
Satisfaction (score) · Confidence · Interests · Feature intent · Highlight ·
Notion Expert · Needs review · Submitted. Event filter chips (reuse `eventChips`).

## 5. Results dashboard (`/results`)

`app/results/page.tsx` + `components/hub/ResultsTab.tsx`. A pure, unit-tested
aggregator `computeResults(bookings, feedback, events)` in `lib/hub/results.ts`
returns per-event rows + an overall total:

- **Attendance funnel:** registered (non-cancelled), approved (`luma_status=approved`),
  checked_in (`status=checked_in`), no_show (`status=no_show`), attendance rate
  = checked_in ÷ approved (guard divide-by-zero → 0).
- **1:1 coverage:** requested (has `requested_slot`), claimed (assigned/checked_in
  with `booked_by_display_name`), completed (checked_in with `booked_by_display_name`).
- **Satisfaction:** responses (feedback rows for event), response rate = responses
  ÷ checked_in, avg score = mean of non-null `satisfaction_score`.

Rendered as per-event cards + an overall summary card at the top.

## Queries (`lib/hub/queries.ts`)

- Extend `listBookings()` select + `HubBooking` with the new fields.
- `listFeedback(): HubFeedback[]` — from `feedback_mirror` (+ event name/date via
  `matched_event_id`).
- Bookings/feedback/events feed `computeResults` on the results page.

## Error handling & testing

- Webhook stays best-effort (returns 200); storing content is inside the existing
  try/catch.
- Unit tests for `computeResults` (attendance rate, 1:1 funnel, response rate,
  divide-by-zero, unmatched feedback excluded from per-event but counted overall).

## Out of scope (per answers)

Confidence-shift + interests are **stored and shown on the feedback page**, but the
results dashboard aggregates only attendance funnel, 1:1 coverage, and satisfaction.
