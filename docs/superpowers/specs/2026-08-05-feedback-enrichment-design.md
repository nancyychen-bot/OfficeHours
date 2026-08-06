# Feedback Form Event-Enrichment — Design Spec

**Date:** 2026-08-05
**Status:** Approved design → ready for implementation plan

## Goal

After an event, guests receive a link to a Notion feedback form (Ambassador
workspace). The form intentionally does **not** ask for the event date or
location. The backend enriches each response with the correct **Event Date** and
**Location** by matching the responder's email to a recent booking in the hub, and
**mirrors** every response into an identical Dev-workspace database.

## The two databases

| Workspace | Feedback DB ID | Written by |
|---|---|---|
| Ambassador | `cf3bd8e9cf0d4594b273835809eef5ad` | the form (source of truth) + hub enrichment |
| Dev | `d9ffd103ba354e35aeaf8e11101c2a42` | hub mirror only |

Both must be **schema-identical**. A setup script reconciles them (see Setup).

## Architecture

Hub-and-spoke, same as the booking sync. The form writes only to the Ambassador
DB; the hub fans out to Dev. Notion databases never talk to each other.

### Data flow

```
Feedback form submitted
  → Notion creates a page in the Ambassador feedback DB (cf3bd8e9…)
  → Notion automation "When page added → Send webhook"
  → POST /api/webhooks/notion/feedback   (x-webhook-secret header)
  → hub verifies secret, fetches the page via the Ambassador integration
  → idempotency: look up ambassador_page_id in feedback_mirror
       already processed → update path; else create path
  → read the response email from the page
  → Supabase: find the matching recent event (see Matching)
       match  → Event Date = event_date, Location = city, Needs review = false
       none   → Needs review = true, Date/Location left blank
  → write those enrichment fields onto the Ambassador row
  → upsert a MIRROR row in the Dev feedback DB with all copyable form fields
       + the same Event Date / Location / Needs review
  → record/refresh ambassador_page_id → dev_page_id in feedback_mirror
  → log to sync_log
```

No loop: only the Ambassador DB has the "page added" automation. The Dev DB is
hub-written only, so mirroring never re-triggers a webhook.

## Matching rules

Match source is the **Supabase hub** (`bookings ⋈ events`). Decisions:

- **Identifier:** the response email, matched case-insensitively against **both**
  `bookings.guest_email` (Luma email) and `bookings.notion_email` (intake email),
  so a mismatch between signup and Notion email still resolves.
- **Window:** events whose `event_date` falls within **7 days before** the
  submission (the feedback page's `created_time`), inclusive.
- **Tiebreak:** if more than one event matches in the window, the **most recent**
  event (`event_date desc`) wins.
- **No match:** leave Event Date + Location blank and set **Needs review = true**.
- **Location value:** the event **city** (`events.city`), written to a Notion
  **select** property. The Notion API auto-creates the option if the city doesn't
  exist yet — proven by the existing booking mirror, which writes `Location` as a
  select with the event city.

## Components (small, isolated, testable)

1. **`app/api/webhooks/notion/feedback/route.ts`** — new webhook route (Node
   runtime). Verifies the secret (reuses `NOTION_AMBASSADOR_WEBHOOK_SECRET`),
   extracts `page_id` (`data.id ?? page_id ?? …`), orchestrates fetch → match →
   enrich → mirror → record. Returns `200` always (best-effort; no Notion
   retry-storm). Idempotent.

2. **`lib/db/feedback.ts`**
   - `selectEventForFeedback(candidates, submittedAt)` — **pure**, unit-tested:
     applies the 7-day window + most-recent tiebreak.
   - `findEventForFeedback(email, submittedAt)` — queries `bookings ⋈ events`
     (email on either column, ordered `event_date desc`), returns
     `{ eventDate, city } | null`.
   - `getFeedbackMirror(ambassadorPageId)` / `recordFeedbackMirror(...)` — the
     idempotency map.

3. **`lib/notion/feedback.ts`**
   - `readFeedbackEmail(page)` — reads the form's email property.
   - `enrichmentProperties({ eventDate, city, needsReview })` — builds the
     Event Date (date) / Location (select) / Needs review (checkbox) write payload.
   - `copyableProperties(page)` — generic copier: reconstructs write payloads for
     the common value types (title, rich_text, select, multi_select, number, date,
     checkbox, url, email, phone_number). Skips computed/uncopyable types
     (formula, rollup, created_time/last_edited, people, relation) with a log.
   - Property names live in one constants block, pinned once the DBs are shared.

4. **Migration `0017_feedback_mirror.sql`** — table
   `feedback_mirror(ambassador_page_id text primary key, dev_page_id text,
   matched_event_id uuid null, needs_review boolean, created_at timestamptz
   default now())`. Regenerate Supabase types.

5. **`scripts/sync-feedback-schema.ts`** — one-off/idempotent: reads both DB
   schemas, takes the union, adds any missing properties to whichever DB lacks
   them, and ensures Event Date (date), Location (select), Needs review (checkbox)
   exist on both. Makes the two DBs identical.

## Configuration / secret

- Reuse **`NOTION_AMBASSADOR_WEBHOOK_SECRET`** for the inbound form webhook (same
  workspace). No new env var.
- Both Notion integrations already have tokens/data-source config; the new DBs
  just need to be shared with them.

## Error handling

- **Idempotent:** if `feedback_mirror` already has the row and the Ambassador row
  is already enriched, a repeat webhook updates rather than duplicates.
- All failures are logged to `sync_log` (direction `notion_amb_in`; actions
  `feedback_enriched` / `feedback_unmatched` / `feedback_mirrored`). The route
  always returns `200` so Notion doesn't retry-storm.

## Testing

Unit tests on the pure matcher `selectEventForFeedback`:
- email-on-either-field resolution (via `findEventForFeedback` query shape)
- 7-day window boundary (inside vs. just outside)
- most-recent tiebreak among multiple in-window events
- no-match → needs-review path

## Setup (prerequisites, in the plan)

1. Share **cf3bd8e9…** with the **Ambassador** integration ("Nancy's Office Hours").
2. Share **d9ffd103…** with the **Dev** integration.
3. Run `scripts/sync-feedback-schema.ts` to make both DBs identical + add the
   three enrichment properties.
4. Add the Notion automation on the Ambassador DB: **When page added → Send
   webhook** to `/api/webhooks/notion/feedback`, header
   `x-webhook-secret: <NOTION_AMBASSADOR_WEBHOOK_SECRET>`.

## Open item resolved at setup

The exact **email property name** on the form (and confirmation one exists) is
read from the live schema during setup and pinned in the constants block.
```
