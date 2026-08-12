# Expert General Feedback + Hub View — Design

**Date:** 2026-08-12
**Status:** Approved (pending spec review)

## Goal

1. Let experts leave **general feedback & learnings** (not tied to a specific guest) from the Slack feedback modal.
2. Represent feedback in Notion with a **"Feedback type"** select (`Guest` / `General`), reusing the existing **Note** field for the text (no dedicated general-text column on the per-1:1 rows).
3. Surface all Slack-captured **expert feedback on the hub** in a new **"Expert Feedback"** tab.

## Decisions (from brainstorming)

- General feedback is entered in the **existing per-1:1 modal** (an extra box), but stored as a **separate entry** with the **Guest blank** — one **General** entry per **(expert, event)**, upserted (no duplicates across an expert's multiple 1:1s).
- Notion: add a **"Feedback type"** select; per-1:1 rows are tagged **Guest**, general entries **General**. Text reuses **Note**.
- The organizer builds the Notion **view** themselves; this work only adds the property + the data.
- Hub: a **new top-level "Expert Feedback" tab** (separate from the existing guest-satisfaction "Feedback" tab).

## Data model

- **`expert_feedback`** (existing, per booking) — unchanged columns. Its Notion push now also sets **Feedback type = "Guest"**.
- **New table `expert_general_feedback`** (migration `0042`), one row per (event, expert):

  | column | notes |
  |---|---|
  | `event_id` uuid FK events | part of PK |
  | `expert_email` text | part of PK |
  | `expert_name` text | for display/title |
  | `note` text | the general feedback |
  | `event_name`, `event_date`, `location` text | captured at submit (for the Notion page + hub, no booking to join from) |
  | `notion_dev_page_id` text | one-way sync idempotency |
  | `responded_at`, `created_at`, `updated_at` timestamptz | |

  PK `(event_id, expert_email)`; upsert `onConflict: "event_id,expert_email"`. No `general_feedback` column is added to `expert_feedback` (general text lives here, per the decision).

## Modal + interaction

- `lib/slack/interaction.ts`: `feedbackModalView` gains an optional multiline **"General feedback & learnings"** input (block `general`, action `general_v`), pre-filled from the expert's existing general entry when present. `parseInteraction` reads it into the `feedback_submit` interaction as `general?: string`.
- `app/api/slack/interactivity/route.ts` (`feedback_submit`): after the existing per-guest `upsertFeedbackAnswer`, if `general` is non-empty, resolve the booking's `event_id` + expert (email/name) + event context and **upsert the general entry**, then `after(() => pushGeneralFeedback(eventId, expertEmail))`.

## Notion sync

- **`lib/notion/expert-feedback.ts`**: add `EF.feedbackType = "Feedback type"`; the per-1:1 mapper sets it to `"Guest"`.
- **New `lib/notion/expert-general-feedback.ts`**: maps a general row → a page in the **same** Dev feedback DB with `Feedback type = "General"`, **Guest / Guest email / Slot / Rating / Attended / Booking(relation) blank**, `Note` = general text, plus Expert / Expert email / Event / Event Date / Location / Responded at. `pushGeneralFeedback` is one-way + race-safe (compare-and-set on `notion_dev_page_id` in `expert_general_feedback`, same pattern as `pushExpertFeedback`).
- **`scripts/configure-expert-feedback-db.ts`**: add the **"Feedback type"** select property (options `Guest`, `General`) to the Dev feedback data source (idempotent `dataSources.update`). Controller runs it.

## Hub view

- New route **`app/expert-feedback/page.tsx`** + component `components/hub/ExpertFeedbackTab.tsx` + nav entry in `components/hub/HubNav.tsx` (`{ href: "/expert-feedback", label: "Expert Feedback" }`), guarded by the existing middleware.
- New read `lib/hub/expert-feedback.ts` → returns a unified, read-only list: **Guest** rows (from `expert_feedback` joined with `booking_details` for guest/slot/event) with attended/rating/note, and **General** rows (from `expert_general_feedback`) with the general note. Columns: Type, Expert, Event/Date, Guest (blank for General), Attended, Rating, Note. Sorted by event date desc then expert.
- Read-only (feedback is captured in Slack; the hub just surfaces it).

## Testing

- `parseInteraction`: `feedback_submit` includes `general`; blank → undefined.
- `feedbackModalView`: renders the general field; pre-fills from an existing general value.
- Per-1:1 mapper sets `Feedback type = Guest`; general mapper sets `Feedback type = General` with Guest blank + Note set.
- `buildGeneralAnswer`/upsert: one row per (event, expert); re-submit updates it.
- Follow existing TDD patterns; keep the suite green.

## Controller / rollout

1. Apply migration `0042` (Supabase MCP).
2. Run the config script to add the **Feedback type** property to the Dev feedback DB.
3. Deploy (merge to main). Organizer builds the Notion view.

## Non-goals / YAGNI

- No editing of feedback from the hub (read-only; Slack is the capture surface).
- No change to the guest-satisfaction "Feedback" tab.
- No `general_feedback` column on `expert_feedback` (general text lives in the new table + Notion Note).
- No general-feedback-only Slack button; it rides the existing per-1:1 modal.
