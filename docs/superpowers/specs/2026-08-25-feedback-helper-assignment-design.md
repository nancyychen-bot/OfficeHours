# Feedback: correct Helper assignment (agent owns event/location/date)

## Context

Guest feedback (Ambassador Notion form) fires a webhook (`/api/webhooks/notion/feedback`)
that today calls `findEventForFeedback(email)` to derive **Event Date, Location, and the
Notion Expert (helper)** from a matched booking, writes them onto the Ambassador row, and
mirrors the row into the Dev feedback DB.

A new **Notion agent** now owns event/location/date on the Dev DB by cross-referencing the
respondent email against two internal event databases — more accurate and event-type-agnostic
than the coded 7-day-window match. The one thing the agent can't determine is the **Helper**,
because that lives only in the hub's Supabase `bookings` (`booked_by_display_name`), and only
Build Bar–style events have experts.

## Goal

Make the **Helper** correct, and stop the webhook from fighting the agent — without disturbing
anything else.

## Scope (exactly two behavior changes)

1. **Fix the Helper.** Attach the expert from the guest's **most recent Build Bar 1:1**
   (their latest booking, dated on/before submission, that has an assigned helper).
2. **Stop writing agent-owned fields to Notion.** The webhook no longer writes Event Date,
   Location, or Needs review onto the Ambassador/Dev rows.

Everything else is untouched: satisfaction score, row title, the form-field mirror into the
Dev DB, and the Supabase `feedback_mirror` attribution (`matched_event_id` / `needs_review`)
that feeds the hub results dashboard.

## Design

### New: `findHelperForGuest(email, submittedAtISO)` — `lib/db/feedback.ts`
- Match `bookings` where `guest_email` OR `notion_email` = email (case-insensitive).
- Keep only rows with an assigned helper (`booked_by_display_name` present) and an
  `event_date` on/before the submission date (a guest can't review a future event).
- Return the one with the **latest `event_date`** as `{ helperName, eventId }`, else `null`.
- No lower-bound window (unlike `findEventForFeedback`): feedback may arrive late, and the
  agent now owns actual event attribution. "Most recent 1:1" chosen for disambiguation.

### Unchanged: `findEventForFeedback`
Still used **only** to populate the Supabase mirror's `matched_event_id` + `needs_review`, so
the hub dashboard's per-event satisfaction rollups keep working exactly as before.

### Webhook — `/api/webhooks/notion/feedback`
- Compute `eventMatch = findEventForFeedback(...)` (Supabase attribution, as today) and
  `helper = findHelperForGuest(...)` (the new, correct helper).
- **Notion enrichment writes Helper only** (plus the pre-existing satisfaction score + title).
  Event Date, Location, and Needs review are dropped from the Notion payload.
- Helper is written to **both** the Ambassador row and the mirrored Dev row.
- Supabase `upsertFeedbackMirror`: `matchedEventId`/`needsReview` from `eventMatch`;
  `notionExpert` from `helper`.

### `enrichmentProperties` — `lib/notion/feedback.ts`
Refactor signature to drop `eventDate`, `city`, `needsReview`. Emits `Notion Expert`
(rich_text), `Satisfaction score` (number, when present), and the row title.

## Non-goals
- Reading the agent's output (decoupled per "most recent 1:1").
- Changing the hub dashboard or the Dev-DB form-field mirror.
- Helper for non-Build-Bar events (there is none → Helper left blank, which is correct).

## Known tradeoff
If a guest attended an old Build Bar 1:1 and later gives feedback about a different
(non–Build-Bar) event, the old helper could be attached. Rare; acceptable per the decoupled
"most recent 1:1" choice. Revisit with an agent-scoped lookup only if it proves wrong in practice.

## Tests
- `findHelperForGuest`: most-recent selection among multiple helper bookings; `notion_email`
  fallback; future-dated booking excluded; no-helper booking → `null`.
- `enrichmentProperties`: payload contains Helper (+ score + title), and does **not** contain
  Event Date / Location / Needs review keys.
