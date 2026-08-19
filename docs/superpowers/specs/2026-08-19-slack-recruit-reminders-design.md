# Slack Recruit Reminders — Design

**Date:** 2026-08-19
**Status:** Approved (pending spec review)

## Goal

When a 1:1 slot is recruited in a city's Slack channel (the "A 1:1 slot just opened
up — can anyone cover it?" post) and stays **unclaimed**, re-post it so it doesn't
get missed:

1. **~3 days after the first recruit post**, if still unclaimed.
2. **2 days before the event**, if still unclaimed.

## Decisions (from brainstorming)

- **Never after the event**, and **at most one reminder per booking per day** — if both
  reminders come due on the same day, they collapse into a single post.
- Up to **2 reminders** total across the cycle (one per stage), each fired at most once.
- **"2 days before"** is computed off the event's **calendar date** (`event_date − 2 days`),
  not a 48-hour clock, so it lands cleanly on a day regardless of slot time.
- Reminders reuse the existing recruit card but with a **distinct header** so they don't
  read as a brand-new opening.
- Stage tracking via **two nullable timestamp columns** on `bookings`, mirroring the
  existing `slack_recruit_posted_at`. (Rejected: deriving from `sync_log` counts —
  fragile; a separate reminders table — overkill for two one-shot stages.)
- A **fresh recruit** (re-unclaim) resets the stages, so a re-recruited slot gets a new
  reminder cycle.

## Current flow (context)

- `postSlackRecruit(bookingId)` (`lib/slack/client.ts`) posts the recruit card and sets
  `slack_recruit_posted_at = now()`. Triggered on unclaim / release
  (`app/api/webhooks/notion/[workspace]/route.ts`) and slot-change (`lib/events/slot-change.ts`).
- `postSlackClaimed(bookingId)` posts a "covered" follow-up and clears
  `slack_recruit_posted_at` when a recruited slot is claimed.
- So `slack_recruit_posted_at IS NOT NULL` ⟺ "currently recruiting, first posted then."

## 1. Data model

Add two nullable columns to `bookings`:

- `slack_recruit_r1_at timestamptz` — when the "3 days after first post" reminder was sent.
- `slack_recruit_r2_at timestamptz` — when the "2 days before event" reminder was sent.

`null` = that stage hasn't fired yet.

- On a **fresh recruit** (`setRecruitPostedAt(id, <non-null>)`): also set `r1_at = null`,
  `r2_at = null` (new cycle).
- On **claim** (`setRecruitPostedAt(id, null)` via `postSlackClaimed`): also null both
  (harmless; keeps rows clean).

`lib/supabase/types.ts` hand-patched for the two columns (per repo practice — the CLI
isn't authed).

## 2. Pure selection logic

`lib/events/recruit-reminder.ts` — pure + unit-tested:

```ts
export interface RecruitReminderRow {
  id: string;
  slack_recruit_posted_at: string;      // non-null (candidates only)
  slack_recruit_r1_at: string | null;
  slack_recruit_r2_at: string | null;
  event_date: string;                   // "YYYY-MM-DD"
}
export interface DueReminder { id: string; stages: Array<"r1" | "r2">; }

export function selectDueRecruitReminders(
  rows: RecruitReminderRow[],
  nowMs: number,
  r1AfterMs = 3 * 24 * 60 * 60_000,   // 3 days after first post
  r2DaysBeforeEvent = 2,
): DueReminder[];
```

Per row, collect **due and unsent** stages:

- **r1** due when `r1_at` is null AND `nowMs ≥ Date.parse(posted_at) + r1AfterMs`.
- **r2** due when `r2_at` is null AND `todayDate ≥ event_date − r2DaysBeforeEvent`,
  comparing calendar dates (parse `event_date` as a plain date, no timezone shift — same
  approach as `shortDate` in `templates.ts`).

Return rows with a non-empty `stages`. "Never after event" is enforced by the candidate
query (`event_date >= today`), not here. Collapsing same-day is handled by the caller
marking **all** returned stages sent in one post.

## 3. DB fetch

`lib/db/bookings.ts` — `listRecruitReminderCandidates(): Promise<RecruitReminderRow[]>`:

Bookings still needing an expert, with their event date:

- `slack_recruit_posted_at IS NOT NULL`
- `status = 'unassigned'`
- `filtered = false`
- `luma_status = 'approved'`
- joined event `event_date >= <today>` (never after the event)

Selects `id, slack_recruit_posted_at, slack_recruit_r1_at, slack_recruit_r2_at` + the
event's `event_date`.

New setter `markRecruitReminderSent(id, stages, at)` in `lib/db/slack.ts` (next to
`setRecruitPostedAt`) sets `r1_at`/`r2_at` for the given stages.

## 4. Slack reminder post

- Extend `buildRecruitBlocks` (`lib/slack/blocks.ts`) with a `reminder?: boolean` field
  that swaps the header/lead line:
  - first post (today): `🙋 A 1:1 slot just opened up — can anyone cover it?`
  - reminder: `⏰ Still open — this 1:1 still needs a Notion expert`
  - Same Event/When/Location/Guest/Role/challenge block + the two "Open … card" buttons.
- `postSlackRecruitReminder(bookingId)` (`lib/slack/client.ts`): like `postSlackRecruit`
  but builds reminder blocks and **does not** touch `slack_recruit_posted_at` (keeps the
  original first-post time). Best-effort; no-op if the city has no channel. Factor the
  shared block-build + `postToCityChannel` into a small helper used by both.

## 5. Daily cron

`app/api/cron/recruit-reminder/route.ts` (`runtime nodejs`), guarded by the shared cron
secret exactly like `comms-retry`. `vercel.json` cron: `{ "path": "/api/cron/recruit-reminder", "schedule": "0 15 * * *" }` (11am ET).

Logic:

```ts
const candidates = await listRecruitReminderCandidates();
const due = selectDueRecruitReminders(candidates, Date.now());
for (const { id, stages } of due) {
  await postSlackRecruitReminder(id);            // one post
  await markRecruitReminderSent(id, stages, new Date().toISOString()); // collapse same-day
  await logSync({ direction: "luma_in", result: "applied", bookingId: id,
                 action: `slack_recruit_reminder:${stages.join("+")}` });
}
return NextResponse.json({ reminded: due.length });
```

`GET = POST` (Vercel Cron issues GET), same as the other cron routes.

## 6. Testing

- `tests/recruit-reminder.test.ts` for `selectDueRecruitReminders`:
  - r1 due (≥3 days after post, unsent) → `["r1"]`
  - r1 not yet due (<3 days) → skip
  - r1 already sent (`r1_at` set) → skip
  - r2 due (today ≥ event_date−2) → `["r2"]`
  - r2 not yet due → skip
  - both due same day → `["r1","r2"]` (caller collapses to one post)
  - mix across rows → only due rows returned
- `tests/slack-blocks.test.ts` extended: reminder header vs first-post header.
- Full suite + `npm run typecheck` green.

## Out of scope

- Editing/greying the original Slack message (needs a Slack app, not an incoming webhook —
  already noted in `postSlackClaimed`).
- Configurable intervals in the hub UI (constants for now).
- Reminders for non-1:1 / waitlisted / filtered bookings.
