# Slack Bot Features — Design

**Date:** 2026-08-07
**Status:** Approved (pending spec review)

## Goal

Use the newly-approved Slack bot (`@Build Bar Bot`, token stored in `.env.local` as `SLACK_BOT_TOKEN`) to add four capabilities on top of the existing incoming-webhook Slack integration:

1. **Agenda DM** — day-of agenda delivered as a Slack DM (in addition to the existing email).
2. **Claim/assignment confirmation DM** — DM the expert when they claim or are assigned a 1:1 (in addition to the existing email).
3. **Recruit posts via bot** — post recruit / "covered" messages via `chat.postMessage` when a channel is configured, falling back to the existing per-city incoming webhook.
4. **Expert feedback capture** — after an event, DM each expert an interactive per-1:1 feedback prompt; store answers in a new Supabase table; one-way sync each row to a new Notion database in the Dev workspace.

**Guiding principle:** DMs are *always additive*. Every email that sends today keeps sending. Slack is a bonus channel and is always best-effort (never blocks or fails the core flow).

## Scopes / secrets (already in place)

- Bot scopes granted: `chat:write`, `im:write`, `incoming-webhook`, `users:read`, `users:read.email`.
- `SLACK_BOT_TOKEN` (xoxb-…) stored in `.env.local` (gitignored). **Must be added to Vercel production env before live use.**
- `SLACK_SIGNING_SECRET` already stored (used to verify the interactivity endpoint).

---

## Component 1 — Slack Web API foundation

**New module `lib/slack/api.ts`** (distinct from `lib/slack/client.ts`, which stays webhook-only):

- `lookupUserByEmail(email: string): Promise<string | null>` — `users.lookupByEmail`. Returns Slack user ID or null (not found / not in workspace).
- `openDM(userId: string): Promise<string | null>` — `conversations.open`. Returns DM channel ID.
- `postMessage(channel: string, blocks: unknown[], text: string): Promise<{ ok: boolean; ts?: string }>` — `chat.postMessage`.
- `dmByEmail(email: string, blocks: unknown[], text: string): Promise<{ ok: boolean; ts?: string }>` — convenience: lookup → open → post.
- `openModal(triggerId: string, view: unknown): Promise<{ ok: boolean }>` — `views.open` (for the Note modal).

**Resilience:** every function catches its own errors, logs to `sync_log` (source `"slack"`), and returns a soft failure. Nothing here throws into a caller. If `SLACK_BOT_TOKEN` is unset, all calls no-op and return `{ ok: false }`.

---

## Component 2 — Agenda DM (Feature 1)

- Extend `sendAgendasForEvent(eventId)` in `lib/events/agenda.ts`: after the existing email send per expert, render a Slack block version of the same `ExpertAgenda` and `dmByEmail(expert.email, blocks, text)`.
- New pure function `buildAgendaBlocks(agenda: ExpertAgenda): unknown[]` — one header + one section per `AgendaItem` (bold time, guest name, challenge, role/company). No new data logic; reuses `buildAgendas`.
- Driven by the existing 2 PM `/api/cron/agenda` cron. Email remains the primary; DM is additive and best-effort.

---

## Component 3 — Claim / assignment confirmation DM (Feature 2)

- In `app/api/webhooks/notion/[workspace]/route.ts`, in the **claim** and **reassign** branches (right after the existing `assigned` email send), add a best-effort `dmByEmail(expertEmail, blocks, text)`:
  > ✅ You're confirmed to help **{guestName}** at **{slotName}** · {eventName} ({eventDate}).
  > 📅 **Please accept the calendar invite in your email** so the 1:1 lands on your calendar.
  > [Open your card]({cardUrl})
- New pure function `buildClaimConfirmBlocks(input)` in `lib/slack/api.ts` helpers or a small `lib/slack/blocks.ts`. Uses the expert email already resolved in the webhook path.

---

## Component 4 — Recruit posts via bot (Feature 3)

- Migration: add `channel_id text` column to `slack_channels`.
- `lib/db/slack.ts`: include `channel_id` in `SlackChannel`, `listSlackChannels`, `upsertSlackChannel`.
- `lib/slack/client.ts`: `postSlackRecruit` / `postSlackClaimed` prefer `chat.postMessage(channel_id, …)` (via `lib/slack/api.ts`) when `channel_id` is present; otherwise fall back to the existing incoming webhook. Behavior is unchanged for any city that has only a webhook.
- Requires `@Build Bar Bot` to be invited to a channel before its `channel_id` is used. Managed via the existing Settings → Slack UI (`SlackManager.tsx` gets a `channel_id` field).

---

## Component 5 — Expert feedback capture (Feature 4)

### 5a. Trigger — new cron `/api/cron/expert-feedback`

- Runs hourly. Authorized via `CRON_SECRET` (same pattern as other crons).
- For each event whose **last slot ended ≥ 2 hours ago**: for each expert with `assigned` or `checked_in` bookings at that event, if no `expert_feedback` rows exist yet for that (event, expert) → create one row per booking (answers null) and send the feedback DM.
- Idempotent: presence of rows = already prompted. Never double-DMs.

### 5b. The DM

One message per expert. One block row per 1:1:

```
Header: "How did your Build Bar 1:1s go? — {eventName} ({eventDate})"
Per 1:1 (section + actions block):
  {guestName} · {slotName} · "{challenge}"
  [✅ Showed up] [🚫 No-show] [Rating ▾ (1–5)] [📝 Note]
```

- Attendance = two buttons; Rating = a `static_select` (options 1–5); Note = a button opening a modal.
- All four elements fit in one `actions` block (4 ≤ 5 element limit).
- Every element's `value` / `action_id` carries the `booking_id`.
- Each interaction **persists immediately** (upsert by `booking_id`), so partial answers are saved.
- On each button click, the endpoint updates that row's blocks to show the recorded choice (via `chat.update` using the payload's `response_url` / message ts) so experts see confirmation and don't re-tap.
- `📝 Note` opens a Slack modal (`views.open`) with a single multiline `plain_text_input`; `private_metadata` carries the `booking_id`; on submit → upsert `note`.

### 5c. Storage — new table `expert_feedback` (migration)

One row per booking:

| column | type | notes |
|---|---|---|
| `booking_id` | uuid PK, FK bookings(id) on delete cascade | the 1:1 |
| `event_id` | uuid FK events(id) | |
| `expert_email` | text | |
| `expert_name` | text | |
| `guest_name` | text | |
| `guest_email` | text | |
| `attended` | boolean, null | showed up / no-show; null until answered |
| `rating` | int, null | 1–5 |
| `note` | text, null | from modal |
| `responded_at` | timestamptz, null | stamped on first answer |
| `notion_dev_page_id` | text, null | sync idempotency |
| `created_at` | timestamptz default now() | |
| `updated_at` | timestamptz default now() | |

DB access layer `lib/db/expert-feedback.ts`:
- `createFeedbackRows(rows)` — bulk insert on send (idempotent: `on conflict (booking_id) do nothing`).
- `hasFeedbackRows(eventId, expertEmail)` — dedup check for the cron.
- `upsertFeedbackAnswer(bookingId, patch)` — patch `{ attended? | rating? | note? }`, stamp `responded_at` if null, bump `updated_at`.
- `getFeedbackRow(bookingId)` — read for Notion push.

### 5d. Interactivity endpoint — `/api/slack/interactivity`

- Public route (excluded from middleware matcher, like other `/api/*`).
- Verifies the Slack signature: HMAC-SHA256 over `v0:{timestamp}:{rawBody}` with `SLACK_SIGNING_SECRET`, compared to `x-slack-signature`; reject if timestamp skew > 5 min. New util `verifySlackSignature(rawBody, timestamp, signature)` in `lib/slack/verify.ts`.
- Parses `payload` (URL-encoded form). Routes:
  - `block_actions` (attendance / rating buttons, note button) → upsert answer or open modal.
  - `view_submission` (note modal) → upsert note.
- Acknowledges within 3 s: respond `200` immediately after the fast DB upsert; the Notion push (5e) is best-effort and does not block the ack. For button clicks, update the message via `response_url`.

### 5e. Notion sync — Dev workspace only, one-way

- Target Dev database (provided by user): `NOTION_DEV_EXPERT_FEEDBACK_DB_ID = 3b5b35e6e67f803d9b44e89ebcfa6daa`. Its data-source ID (`NOTION_DEV_EXPERT_FEEDBACK_DATA_SOURCE_ID`) is derived once from `databases.retrieve` and stored in env (same as the bookings/feedback DBs).
- One-time script `scripts/configure-expert-feedback-db.ts` **updates the existing DB's schema** (adds/ensures the properties below via `databases.update`) rather than creating a new DB. It also prints the resolved data-source ID for env.
- The DB must be shared with the Dev integration for the token to see it.
- New module `lib/notion/expert-feedback.ts`:
  - Property schema (exact Notion property names the mapper writes):
    - `Expert` (title) ← `expert_name`
    - `Expert email` (rich_text) ← `expert_email`
    - `Guest` (rich_text) ← `guest_name`
    - `Guest email` (rich_text) ← `guest_email`
    - `Event Date` (date) ← event date
    - `Location` (rich_text) ← event city
    - `Event` (rich_text) ← event name
    - `Slot` (rich_text) ← slot name
    - `Attended` (select: `Showed up` / `No-show`; empty when null) ← `attended`
    - `Rating` (number) ← `rating`
    - `Note` (rich_text) ← `note`
    - `Responded at` (date) ← `responded_at`
    - `Booking ID` (rich_text) ← `booking_id` (traceability / idempotency fallback)
  - `pushExpertFeedback(bookingId)` — read the row; if `notion_dev_page_id` set and page live → update; else create (idempotency fallback: query by `Booking ID`), then store `notion_dev_page_id`. One-way only; no inbound webhook, no echo guard needed.
- Triggered best-effort after each `upsertFeedbackAnswer` (fire-and-forget from the interactivity handler; failures log to `sync_log`).

---

## Cron / config changes

- `vercel.json`: add cron `{ "path": "/api/cron/expert-feedback", "schedule": "0 * * * *" }` (hourly).
- No new email-log `event_kind` values (feature 4 sends DMs, not emails).

## Migrations (latest is 0037)

- `0038_expert_feedback.sql` — create `expert_feedback` table.
- `0039_slack_channels_channel_id.sql` — add `channel_id` to `slack_channels`.
- Regenerate `lib/supabase/types.ts` after both.

## Manual setup (user, at rollout)

1. Add `SLACK_BOT_TOKEN` to Vercel production env.
2. Slack app → **Interactivity & Shortcuts** → enable → Request URL `https://office-hours-three.vercel.app/api/slack/interactivity` → save (reinstall if prompted).
3. Share the Dev "Expert Feedback" DB (`3b5b35e6e67f803d9b44e89ebcfa6daa`) with the Dev integration; run `scripts/configure-expert-feedback-db.ts` to set its schema + print the data-source ID; set `NOTION_DEV_EXPERT_FEEDBACK_DB_ID` and `NOTION_DEV_EXPERT_FEEDBACK_DATA_SOURCE_ID` in Vercel.
4. (Feature 3, gradual) Invite `@Build Bar Bot` to each city channel; add each `channel_id` via Settings → Slack.

## Testing

- Unit: `verifySlackSignature` (valid/invalid/stale), `buildAgendaBlocks`, `buildClaimConfirmBlocks`, the feedback DM block builder, `expert_feedback` upsert/dedup logic, Notion property mapper.
- Route-level: interactivity endpoint parses `block_actions` and `view_submission` payloads and calls the right upsert; rejects bad signatures.
- Best-effort paths (Slack down / user not found) log and no-op without throwing.
- Follow existing TDD patterns; keep the current suite green.

## Revision (post-live-test): feedback interaction is a modal form, not inline taps

The original §5b design (inline attendance/rating buttons + note modal, each tap
auto-saving) proved confusing in live testing — no explicit "Send", and rapid taps
raced to create duplicate Notion pages. **Replaced with a form model:**

- The DM shows one **"Give feedback"** button per 1:1 (`action_id: fb_open`, value = bookingId).
- Clicking opens a **modal form** (`feedbackModalView`) with attendance (radio: Showed up / No-show), rating (select 1–5), and a note (text) — all optional — plus a **Submit** button. Re-opening pre-fills prior answers.
- Submit fires one `view_submission` → one `upsertFeedbackAnswer` (all fields at once) → one Notion push. Blank fields are left `undefined` so they never clobber prior answers.
- This gives an explicit Send and inherently avoids the duplicate-page race (one write per submit). The Notion push is additionally made race-safe via a Supabase compare-and-set claim on `notion_dev_page_id` (create the page at most once, then update it).

Interaction types: `open_feedback` / `feedback_submit` (see `lib/slack/interaction.ts`).

## Non-goals / YAGNI

- No inbound Notion→Supabase sync for expert feedback (one-way only).
- No side effects on booking status from a "No-show" answer (record only).
- No migration of any city off incoming webhooks as part of this work (bot posting is opt-in per channel).
- Native Slack "Claim" button is explicitly out of scope (per prior decision).
