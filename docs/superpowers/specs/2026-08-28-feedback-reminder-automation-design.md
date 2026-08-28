# Automated post-event feedback reminder

**Date:** 2026-08-28
**Status:** Approved

## Goal

Automatically send a *second* "we'd still love your feedback" email to guests who
**checked in** at an event but have **not yet submitted** feedback, **2 days after**
the event. Make the reminder a first-class editable template so the cron, the manual
script, and the Settings → Emails page all share one source of copy.

## Behaviour

- Fires at **09:00 event-local time, `event_date + 2` days** (`isSendDue`, `offsetDays: +2`,
  `targetHour: SEND_HOUR`).
- Recipients: bookings with `status = 'checked_in'` and a `guest_email`, **minus** anyone
  who already submitted feedback.
- "Already submitted" = their `guest_email` or `notion_email` (lowercased) appears in
  `feedback_mirror` for a row with `submitted_at >= event_date` **OR** `matched_event_id = event.id`.
  - Accepted gap: a submitter whose feedback email differs from their booking email
    (e.g. Megan at NYC) can't be auto-detected and may receive one reminder.
- Sends once per event, guarded by a new `events.feedback_reminder_sent_at` column.
- Idempotent per recipient via `email_log` dedup on `(booking_id, event_kind, recipient_email)`.

## Components

1. **Template** `feedback_reminder__guest` in `TEMPLATE_REGISTRY` (genericized copy,
   `{{firstName}}` / `{{feedbackLink}}` / `{{calendarLink}}`). Added to `CommsKind`,
   `RECIPIENTS` (`["guest"]`), `TemplateKey`, and the EmailEditor **"After the event"** stage.
2. **Skip logic** in `lib/events/feedback.ts`: `listRespondedEmails(event)` → `Set<string>`
   of lowercased emails; `isEligibleForFeedbackReminder(booking, responded)`.
3. **Dispatch** `dispatchFeedbackRemindersForDueEvents(now)` in `lib/events/feedback.ts`.
4. **DB**: add `events.feedback_reminder_sent_at timestamptz null`; backfill the NYC event
   (`f7273c13-…`) to `now()` since the reminder was already sent manually.
5. **Cron**: `app/api/cron/feedback-reminder/route.ts` + `vercel.json` entry `0 * * * *`.
6. **Schedule**: widen `scanWindow` `from` from `-1` to `-3` so `+2`-offset events are fetched.
7. **Script**: rewrite `scripts/send-feedback-reminder.ts` onto the comms/template path
   (shared copy + skip logic; keeps `--exclude`, `--dry-run`); add `send:feedback-reminder`
   npm script.

## Copy (default; editable in Settings)

Subject: `One more nudge — we'd still love your Build Bar feedback 💜`

> Hi {{firstName}},
>
> Thank you again for coming to **Notion Build Bar** — it was so great to have you, and we
> hope you left with something you're excited to build.
>
> We haven't heard from you yet, and we'd still really love to know how it went — it takes
> about **2 minutes**, and your feedback directly shapes the next event.
>
> 👉 **[Share your feedback]({{feedbackLink}})**
>
> *If you worked one-on-one with a Notion expert, we'd especially love to hear how that went.*
>
> To catch a future Build Bar or community event, follow our **[Notion calendar]({{calendarLink}})**.
>
> With gratitude,
> The Notion Community Team
>
> *If you have any questions please email communityevents@makenotion.com*

## Testing

- `listRespondedEmails` / eligibility: matches by guest+notion email, respects the
  `submitted_at >= event_date` / `matched_event_id` scope.
- `dispatchFeedbackRemindersForDueEvents`: fires only at +2 @ 9am local; skips responded;
  marks `feedback_reminder_sent_at`; second run is a no-op.
- Existing `isSendDue` / `scanWindow` tests still pass with the widened window.

## Out of scope

- Migrating the other inline one-offs (arrive-early, cowork-notice) into Settings.
