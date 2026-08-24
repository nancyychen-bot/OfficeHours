# Non-Free Day-Before Checklist + Drop Slot-Change from T-1 Emails — Design

**Date:** 2026-08-24
**Status:** Draft (awaiting user review)

## Goal

1. A new **day-before (T-1) checklist email for approved *non-Free* guests** —
   "what to bring," without the Notion AI activation step (that's the Free-plan
   nudge). Together with the existing Free day-before, every approved guest then
   gets exactly one day-before checklist.
2. **Remove the "Change your slot" line from T-1 emails** — slots can't be changed
   that close to the event, so offering it the day before is misleading.

## Audience (new email)

`isEligibleForDayBeforePaid(b)` = `luma_status === "approved"` && `notion_plan !==
"Free"` (paid plans **and** blank/unknown) && `!filtered` && `!!guest_email` &&
`status !== "cancelled"`. Complements `isEligibleForPrep` (which is `=== "Free"`),
so the two day-before sends cover the whole approved cohort with no overlap.

## Components

### 1. New comms kind `prep_reminder_day_before_paid`
- **Recipients:** `["guest"]` (`lib/email/comms.ts`).
- **Template `prep_reminder_day_before_paid__guest`** (`lib/email/templates.ts`) —
  the Free day-before copy minus the Notion AI line/trial link **and** minus the
  change-slot line:

  > **Subject:** Your Notion Build Bar 1:1 is tomorrow ✨
  >
  > Hi {{firstName}},
  >
  > Quick reminder — your **Notion Build Bar** session is **tomorrow**. We can't wait
  > to build with you!
  >
  > **What to bring:**
  > ✅ Your 1:1 slot — check for the calendar invite (if you have one)
  > ✅ Your laptop
  >
  > Can't make it? Please **[cancel your registration]({{eventUrl}})** so we can free
  > up your spot.
  >
  > See you tomorrow,
  > {{SIGNOFF}}

- **email_log migration `0047`** adds `prep_reminder_day_before_paid` to the
  `event_kind` check constraint.

### 2. Sender + cron wiring (`lib/events/prep.ts`, `app/api/cron/prep-reminder/route.ts`)
- Add `isEligibleForDayBeforePaid` + `sendPrepDayBeforePaidForEvent(eventId)` +
  `sendPrepDayBeforePaidForLeadWindow(now)` (T-1 window, `isoDatePlusDays(now, 1)`),
  mirroring the existing Free day-before senders but sending
  `prep_reminder_day_before_paid` and gating on the non-Free predicate.
- In the prep-reminder cron, call the new lead-window sender alongside
  `sendPrepDayBeforeForLeadWindow()`; add its counts to the `logSync` note.

### 3. Editor visibility (`components/hub/EmailEditor.tsx`)
Add `prep_reminder_day_before_paid__guest` to the "Before the event" stage's `keys`.

### 4. Remove the change-slot line from the Free day-before
In `lib/email/templates.ts`, delete the `"Need a different time? **[Change your
slot]({{slotChangeLink}})** …"` line (and its trailing `""` spacer) from
`prep_reminder_day_before__guest` **only**. Leave the same line intact in:
- `prep_reminder__guest` (T-3 — changes still possible), and
- `assigned__guest` (on-claim confirmation, not a scheduled T-1 send).

## Out of scope / notes
- `assigned__guest` keeps its change-slot line (flagged to the user; it fires on
  claim, which can happen days early). Revisit separately if desired.
- No new cron; reuses the daily prep-reminder cron's T-1 window.
- Free `prep_reminder_day_before` audience/behavior otherwise unchanged.

## Testing
- `isEligibleForDayBeforePaid`: true for approved paid + approved blank-plan; false
  for Free, non-approved, filtered, no-email, cancelled.
- `prep_reminder_day_before_paid__guest` renders: contains "What to bring" + "Your
  laptop"; does **not** contain "Notion AI" or "Change your slot".
- `prep_reminder_day_before__guest` (Free) no longer contains "Change your slot"
  (regression guard); still present in `prep_reminder__guest`.

## Rollout
1. Apply migration `0047`. 2. Deploy. 3. Next prep-reminder cron run sends the
non-Free day-before at T-1 to the paid/unknown-plan approved cohort; Free day-before
and both prep emails behave as before (minus the slot-change line at T-1).
