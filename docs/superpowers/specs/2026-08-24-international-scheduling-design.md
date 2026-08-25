# Timezone-Correct Scheduling for International Events — Design

**Date:** 2026-08-24
**Status:** Draft (awaiting user review)

## Problem

The day-based email crons compute a **UTC** "today/tomorrow/T-3" and match it against
an event's `event_date`, which is stored as the event's **local** calendar date. This
only works because every event so far is US-timezone and the crons run at US-daytime
UTC. Adding **Europe and Asia** events breaks it: the UTC target date and the event's
local date diverge, so day-before / prep / decline / rematch / agenda / recruit-r2
emails fire on the wrong day or not at all.

Separately, even once the right day is matched, the crons fire at a **fixed UTC time**,
so a "day-before" email would land at wildly different local hours across regions
(~2pm London, ~10pm Tokyo, ~6am LA).

## What's already timezone-safe (no change)

Stored/compared as absolute instants, so international events already work:
- Slot times (`slots.starts_at/ends_at` are `timestamptz`) and the `.ics` invites
  (emit UTC `Z`; the attendee's calendar localizes).
- **No-show** detection and **feedback "event ended"** — both compare *now* to the
  absolute slot time, not to a calendar date.
- Each event stores its own IANA `timezone`; `localCalendarDate` uses `Intl` (DST-safe).
- Recruit reminder **r1** ("3 days after the Slack post") — compares to an absolute
  posted-at timestamp. Untouched.

The breakage is confined to the **cron date-window logic**.

## Decisions (confirmed with user)

1. **Send timing:** run the affected crons **hourly**; each event fires when its **own
   local clock** reaches the target hour. Consistent local experience everywhere.
2. **Target local hour:** **9am local** for the guest/expert sends; **8am local** for
   decline-pending (so declines are reflected before the reminders go out).
3. **Timezone fallback:** if Luma returns no timezone, **refuse to register** the event
   with a clear error — never silently default to LA.

## Component 1 — shared scheduling helper (`lib/events/schedule.ts`, new, pure)

```ts
/** The event-local calendar date (YYYY-MM-DD) and hour (0–23) of an instant. */
export function localNowParts(now: Date, timeZone: string): { date: string; hour: number };

/** A plain calendar-date shift (YYYY-MM-DD + n days), DST-agnostic. */
export function shiftDate(ymd: string, days: number): string;

/**
 * True when the event's local clock has reached (event_date + offsetDays) at
 * targetHour, and it is still that local day. "At or after, same local day" so a
 * missed hourly tick self-heals on the next tick within the day; email_log dedup
 * makes the eventual send exactly-once.
 */
export function isSendDue(
  now: Date,
  event: { event_date: string; timezone: string },
  rule: { offsetDays: number; targetHour: number },
): boolean;
```

`isSendDue` logic: `target = shiftDate(event_date, offsetDays)`; `{date, hour} =
localNowParts(now, event.timezone)`; **due iff `date === target && hour >= targetHour`.**
(Same-local-day upper bound: once the local day rolls past `target`, it lapses — a
"day-before" reminder never leaks onto the event day.)

### Per-send rules
| Send | offsetDays | targetHour |
|---|---|---|
| Prep (T-3) | −3 | 9 |
| Day-before (Free) | −1 | 9 |
| Day-before (non-Free / paid) | −1 | 9 |
| Decline-pending | −1 | 8 |
| Rematch-apology | −1 | 9 |
| Day-of agenda | 0 | 9 |
| Recruit reminder r2 | −2 | 9 |

## Component 2 — dispatchers use the predicate

Each day-based dispatcher changes from "list events for a UTC target date" to: **fetch a
small forward window of events** (`event_date` within ~[today−1, today+4] by a loose UTC
bound — a safe superset) and keep those where `isSendDue(now, event, rule)`. Then run the
existing per-event send unchanged. Affected:
- `lib/events/prep.ts` — `sendPrepForLeadWindow` (T-3), `sendPrepDayBeforeForLeadWindow`
  and `sendPrepDayBeforePaidForLeadWindow` (T-1).
- `lib/events/decline-pending.ts` — `dispatchDeclinePendingForTomorrow`.
- `lib/events/rematch.ts` — `dispatchRematchForTomorrow`.
- `lib/events/agenda.ts` — the day-of dispatcher.
- `lib/events/recruit-reminder.ts` — replace the `dateUtcMs(event_date)` r2 math with
  `isSendDue(..., { offsetDays: -2, targetHour: 9 })`; r1 unchanged.

A tiny `lib/db/events.ts` helper `listEventsInDateRange(fromYmd, toYmd)` backs the
forward-window fetch (or reuse/extend `listEventsByDate`).

## Component 3 — crons go hourly (`vercel.json`)

Change these five from a fixed daily time to hourly (`0 * * * *`): `prep-reminder`,
`decline-pending`, `rematch-apology`, `agenda`, `recruit-reminder`. Safe: they no-op off
target, and `email_log`/stage-stamp dedup makes re-fires harmless. (`no-show`,
`comms-retry`, `feedback`, `reconcile`, `luma-stats`, `backup`, `expert-feedback`
unchanged.)

## Component 4 — timezone guard (`lib/events/register.ts`) — FIRST task

Replace `const timezone = detail.timezone ?? "America/Los_Angeles";` with a hard check:
if `detail.timezone` is missing/blank, `throw new Error("Luma didn't return a timezone
for this event — set the event timezone in Luma and retry.")`. The add-event route
already surfaces a generic failure message; the thrown detail is logged server-side.
This ships first so a bad international event can't be created while the rest is built.

## Testing

- `isSendDue` (the core): a US (America/Los_Angeles), a London (Europe/London), and a
  Tokyo (Asia/Tokyo) event each become due on the correct local day at the target hour
  and NOT before / NOT the following local day; a **DST-boundary** date; "at-or-after"
  fires later the same local day (missed-tick self-heal); decline (8am) vs reminder (9am)
  ordering within a day.
- `shiftDate` across month/year and DST boundaries.
- `register`: throws when `detail.timezone` is absent; unchanged when present.
- Dispatcher wiring stays covered by the existing guest-eligibility tests (unchanged).

## Rollout

1. Deploy (tz guard active immediately).
2. `vercel.json` hourly crons register on deploy.
3. Add a Europe and an Asia event; confirm via `sync_log` that each day-based send fires
   at ~9am (decline ~8am) **local** on the correct day.

## Open risks

- **Full-local-day cron outage** → that day's send lapses (no next-day catch-up, by
  design, so a day-before never leaks to the event day). This is strictly better than the
  current daily crons (one tick/day → ~15 hourly ticks/day). Accepted.
- **Hourly cron volume** — five extra no-op-mostly runs per hour; negligible, and the
  ledger keeps them idempotent.
