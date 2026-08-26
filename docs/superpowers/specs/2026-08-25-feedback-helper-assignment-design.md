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

## Scope

1. **Fix the Helper.** Attach the expert from the guest's **most recent Build Bar 1:1**
   (their latest booking, dated on/before submission, that has an assigned helper).
2. **Event Date / Location = best-effort safety net.** The Notion agent is the primary
   source (it cross-references the internal event DBs across all event types). The webhook
   writes Event Date/Location **only when it can match a Build Bar booking**, and only when it
   has a value — so it never clobbers what the agent set, but nothing is blank for Build Bars
   if the agent fails. **Needs review is never written by the webhook** (agent owns it), so
   non-hub events aren't false-flagged.

Everything else is untouched: satisfaction score, row title, the form-field mirror into the
Dev DB, and the Supabase `feedback_mirror` attribution (`matched_event_id` / `needs_review`)
that feeds the hub results dashboard.

> **Decision history:** initially scoped as "Helper only, agent owns event/location/date."
> Revised after considering agent failure → the webhook keeps a best-effort event/location
> safety net for Build Bars (agent overrides). See the follow-up below for the larger
> "code becomes the agent" option.

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

## Code becomes the agent for all event types (IMPLEMENTED)

Rather than depend on the (unreliable) Notion agent, the code cross-references both sources by
email: hub Supabase (Build Bar) **plus** the **"Notion 101 Guest Database"** (data source
`3c7b35e6-e67f-805f-834f-000b61e0cd8a`, dev workspace — the `…8018` link the user shared is an
inline linked view of it). That DB already has Email / Notion Account Email / Event / Event
Date / **Location** (a full street address), so no property needed adding.

- `lib/notion/notion101.ts`: `findNotion101Event(email, submittedAt)` queries the data source
  (email or notion-account-email match, `Event Date` on/before submission), returns the most
  recent `{ eventDate, city, event }`. `cityFromAddress` extracts the city ("75 Varick St, New
  York, NY 10013, USA" → "New York"); best-effort, falls back to the raw string. Errors → null
  (never breaks feedback processing).
- Webhook: Event Date + Location come from whichever of the two sources has the most recent
  event. Helper stays hub-only; `matched_event_id` (dashboard) stays Build Bar-only.
- Access: required connecting the dev integration (**`Luma - Notion Dev`**) to the database.

Verified live: `nchen@makenotion.com` → `{ date: 2026-12-18, city: New York }`.

## Tests
- `findHelperForGuest`: most-recent selection among multiple helper bookings; `notion_email`
  fallback; future-dated booking excluded; no-helper booking → `null`.
- `enrichmentProperties`: payload contains Helper (+ score + title), and does **not** contain
  Event Date / Location / Needs review keys.
