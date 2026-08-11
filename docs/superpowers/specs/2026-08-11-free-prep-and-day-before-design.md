# Free-only Prep + Day-before Reminder — Design

**Date:** 2026-08-11
**Status:** Approved (pending spec review)

## Goal

1. Restrict the existing 3-day pre-event prep email to **Approved guests on the Free Notion plan** only.
2. Add a **day-before (T-1) reminder** with its own editable copy, to the same audience.
3. Both emails editable on Settings → Emails (the day-before one appears there automatically).

## Decisions (from brainstorming)

- **Restrict the existing prep** (not a separate email): approved guests on Plus/Business/Enterprise — or who didn't answer the plan question — no longer receive the prep email.
- **Day-before reminder is its own template** (distinct comms kind + copy), not a resend of the 3-day copy.
- `notion_plan` stores exactly `Free` / `Plus` / `Business` / `Enterprise` (verified); the filter is `notion_plan === "Free"`, which also excludes null/unanswered.

## 1. Narrow the prep audience

`lib/events/prep.ts` — add one clause to `isEligibleForPrep`:

```ts
export function isEligibleForPrep(b: Booking): boolean {
  return (
    b.luma_status === "approved" &&
    b.notion_plan === "Free" &&
    !b.filtered &&
    !!b.guest_email &&
    b.status !== "cancelled"
  );
}
```

This predicate is the single source of truth for **both** the 3-day prep and the new day-before reminder, so they always target the same Free+Approved group.

**Copy cleanup (prep is now Free-only):** remove the paid-plan disclaimer line — `*Already on a Business or Enterprise plan, or used a trial before? You're all set — no need to sign up.*` — from BOTH places:
- the code default `prep_reminder__guest` in `lib/email/templates.ts` (line ~171), and
- the **published** `live_body` in the `email_overrides` DB row (`key = 'prep_reminder__guest'`), which is what actually sends. Remove just that paragraph, preserving the rest of the live copy. (Controller runs the DB update.)

## 2. Day-before reminder email

- **New comms kind** `prep_reminder_day_before` and **template** `prep_reminder_day_before__guest` (recipient: guest), registered in `lib/email/templates.ts` (`CommsKind`, `TemplateKey`, `TEMPLATE_REGISTRY`) and `lib/email/comms.ts` (`RECIPIENTS: { prep_reminder_day_before: ["guest"] }`).
- **Migration `0041`** adds `prep_reminder_day_before` to the `email_log.event_kind` CHECK constraint (each new kind needs one, or `reserveCommsSlot`/`finalizeComms` inserts fail at runtime).
- **Default copy** (editable): a short "your Notion Build Bar 1:1 is **tomorrow**" reminder. Reuses the same `buildVars` placeholders and house style as prep — includes the **slot-change form** link and the "for other questions, reach out to communityevents@makenotion.com" line; all links bold (`inlineFormat` already bolds links). Subject conveys "tomorrow".
- A distinct kind means the T-1 send is **not** suppressed by the 3-day prep's `email_log` dedup.

## 3. Cron wiring

Extend the existing daily cron `app/api/cron/prep-reminder/route.ts` (already runs 4pm daily) to fire **both** windows:

- 3-day: `sendPrepForLeadWindow()` (unchanged — targets events at `now + PREP_LEAD_DAYS`, sends kind `prep_reminder`).
- 1-day: new `sendPrepDayBeforeForLeadWindow(now)` in `lib/events/prep.ts` — targets events at `now + 1` day, sends kind `prep_reminder_day_before` to `isEligibleForPrep` guests.

One cron, two sends; each idempotent via `email_log` dedup. No new `vercel.json` entry needed.

New function shape (mirrors `sendPrepForLeadWindow`):

```ts
export async function sendPrepDayBeforeForEvent(eventId: string): Promise<number> {
  const eligible = (await listBookingsForEvent(eventId)).filter(isEligibleForPrep);
  for (const b of eligible) await sendBookingComms(b.id, "prep_reminder_day_before");
  return eligible.length;
}

export async function sendPrepDayBeforeForLeadWindow(now: Date = new Date()): Promise<{ events: number; guests: number }> {
  const events = await listEventsByDate(isoDatePlusDays(now, 1));
  let guests = 0;
  for (const ev of events) guests += await sendPrepDayBeforeForEvent(ev.id);
  return { events: events.length, guests };
}
```

## 4. Settings page

Settings → Emails renders every template in the registry (the `ALL_STAGES` catch-all in `EmailEditor.tsx`), so `prep_reminder_day_before__guest` appears automatically once registered. The 3-day prep (`prep_reminder__guest`) is already editable there. No UI code needed beyond registering the template.

## 5. Testing

- `isEligibleForPrep`: eligible for Free+Approved; excluded for Plus/Business/Enterprise and null plan; still excluded when filtered / not approved / no email / cancelled.
- `sendPrepDayBeforeForLeadWindow` selection: targets `now + 1`.
- Template renders: `renderComms`/`renderTemplate` for `prep_reminder_day_before__guest` produces subject + html + text with the slot-change link.
- Follow existing TDD patterns; keep the suite green.

## Non-goals / YAGNI

- No change to who gets the *assigned* (calendar invite) email or Luma's own approval email — those still reach all matched/approved guests regardless of plan.
- No new cron schedule (reuse the daily prep cron).
- No per-plan customization beyond Free vs not-Free.
- No hub UI beyond the auto-listed template editor.
