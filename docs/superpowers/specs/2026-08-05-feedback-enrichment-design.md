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

| Workspace | Feedback DB ID | Data source ID | Written by |
|---|---|---|---|
| Ambassador | `cf3bd8e9cf0d4594b273835809eef5ad` | `9bfd46cd-519f-4c0b-95be-08ac97549b51` | the form (source of truth) + hub enrichment |
| Dev | `d9ffd103ba354e35aeaf8e11101c2a42` | `3d542dad-4839-4dae-b56f-911c0e60fb11` | hub mirror only |

Both are shared with their respective "Nancy's Office Hours" integrations.
Both must be **schema-identical**. A setup script reconciles them (see Setup).

### Live schema (discovered 2026-08-05)

Both DBs already share the same property **names and types**; they differ only in
select/multi-select **options**, and neither has a Needs-review flag.

| Property | Type | Notes |
|---|---|---|
| Submission | title | |
| What email do you use for Notion? | email | **the match key** |
| Which feature or workflow will you try this week? | rich_text | |
| What was the highlight, and anything we should improve? | rich_text | |
| How satisfied were you with this event? | select | options differ between DBs |
| How confident are you using Notion after this event vs. before? | select | options differ between DBs |
| Would you be interested in any of these? | multi_select | options differ between DBs |
| Event Date | date | already exists on both |
| Location | select | already exists on both |
| Created time | created_time | used for the 7-day window |
| **Needs review** | checkbox | **to be added to both** |

**Canonical options = Ambassador** (it's the live form, so its stored values are
ground truth). The reconciliation script rewrites the Dev DB's select/multi-select
options to match Ambassador exactly, and adds the Needs-review checkbox to both.

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
   - `readFeedbackEmail(page)` — reads the `What email do you use for Notion?`
     (type `email`) property.
   - `enrichmentProperties({ eventDate, city, needsReview })` — builds the
     Event Date (date) / Location (select) / Needs review (checkbox) write payload.
   - `copyableProperties(page)` — generic copier: reconstructs write payloads for
     the value types actually present (title, rich_text, email, select,
     multi_select, date). Skips computed/read-only types (created_time) and any
     unexpected type with a log.
   - Property names live in one constants block (pinned from the live schema):
     `EMAIL = "What email do you use for Notion?"`, `EVENT_DATE = "Event Date"`,
     `LOCATION = "Location"`, `NEEDS_REVIEW = "Needs review"`.

4. **Migration `0017_feedback_mirror.sql`** — table
   `feedback_mirror(ambassador_page_id text primary key, dev_page_id text,
   matched_event_id uuid null, needs_review boolean, created_at timestamptz
   default now())`. Regenerate Supabase types.

5. **`scripts/sync-feedback-schema.ts`** — one-off/idempotent: makes the two DBs
   identical using **Ambassador as canonical**. It (a) rewrites the Dev DB's
   select/multi-select options (`How satisfied…`, `How confident…`, `Would you be
   interested…`, `Location`) to match Ambassador's exactly, and (b) adds the
   **Needs review** checkbox to both DBs. Event Date + Location already exist on
   both, so no other property adds are needed. Writes via `dataSources.update`
   against each DB's data source id.

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

1. ✅ Both DBs are shared with their "Nancy's Office Hours" integrations (done).
2. Run `scripts/sync-feedback-schema.ts` to align Dev's dropdown options to
   Ambassador and add the **Needs review** checkbox to both.
3. Add the Notion automation on the Ambassador DB: **When page added → Send
   webhook** to `/api/webhooks/notion/feedback`, header
   `x-webhook-secret: <NOTION_AMBASSADOR_WEBHOOK_SECRET>`.

## Resolved during exploration

- Email match property: **`What email do you use for Notion?`** (type `email`).
- Event Date + Location already exist on both DBs.
- Canonical dropdown options: **Ambassador**.
```
