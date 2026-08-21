# Guest-Cancelled vs. Organizer-Declined Emails — Design

**Date:** 2026-08-21
**Status:** Draft (awaiting user review)

## Problem

A booking reaching `luma_status = declined` currently fires one comms kind
(`declined`) with "we've reached capacity" wording, regardless of *why* it was
declined. In reality there are two very different causes:

1. **Guest cancels** — the guest sets themselves "Not Going" on Luma. Arrives via
   the **Luma webhook** (`guest.updated`, `approval_status: declined`).
2. **Organizer declines** — the team sets *Luma Status → Declined* in **Notion**
   (e.g. at capacity / not a fit). Arrives via the **Notion webhook**.

Today both cases send the expert the "at capacity" note, which mis-states the
reason when the guest simply cancelled (the far more common case — see the
production incident where a claimed expert got an "at capacity" decline seconds
after a guest self-cancelled).

## Key insight: distinguish by origin

The two causes come in on **different code paths**, so we can route them:

| Cause | Inbound path | Comms |
|---|---|---|
| Guest cancels | Luma webhook → `ingestRegistration` (Luma-origin) | **`guest_cancelled`** (new, expert-only) |
| Organizer declines | Notion webhook → `applyLumaStatus` (source `dev`/`ambassador`) | `declined` (existing, unchanged) |
| Hub day-before auto-decline | cron → `applyLumaStatus` (source `cron`) | `declined` (host-side) |

**Assumption (confirmed with user):** the team triages (approve/decline) in
**Notion**, not in Luma. So a Luma-origin `declined` is treated as a guest
cancellation. Luma's payload exposes only `approval_status: declined` with no field
distinguishing guest-not-going from host-declined-in-Luma, so origin is the only
signal. (If the team ever declines a guest directly in Luma, it would be labeled a
guest cancellation.)

## The guest gets nothing on self-cancel

When a guest cancels themselves, we send them **no email** — they initiated it and
Luma already confirms the cancellation to them; a "your booking was cancelled"
note from us is redundant and reads oddly. Only the **expert** is notified (their
claimed slot has freed up). The organizer-decline path (`declined`) still emails
the guest, because there the guest did *not* initiate it and needs to be told.

## New comms kind: `guest_cancelled` (expert-only)

- **Recipients:** `["helper"]`. No guest template.
- **Natural audience gate:** with helper-only recipients, this only actually sends
  when the booking had an assigned expert (`booked_by_email` set). A cancelled
  coworker (no expert) or an unclaimed-but-requested 1:1 (no expert yet) results in
  no email to anyone. To avoid a log-noise "helper skipped" entry on every
  coworker cancel, `ingestRegistration` only calls it when `prior.booked_by_email`
  is set (see routing).
- **Calendar:** a `CANCEL_CALENDAR_KIND` — attaches the cancel `.ics` (same
  `UID:booking-<id>`) so the claimed 1:1 is removed from the expert's calendar.

### Template (approved via preview send)

`guest_cancelled__helper`:
> **Subject:** Slot freed — {{guestName}} won't be joining
>
> Hi {{firstName}},
>
> Quick update: {{guestName}} has cancelled their booking and won't be joining, so
> the slot you'd claimed has been released. Nothing you need to do.
>
> {{SUPPORT_HELPER}}
>
> Thanks for building with us,
> {{SIGNOFF}}

`declined__guest` / `declined__helper` stay **unchanged** (original "at capacity"
wording) — they now fire only on the organizer-decline path.

- **email_log migration** (`0045`) adds `guest_cancelled` to the `event_kind`
  check constraint (same pattern as prior kinds).

## Routing change (`lib/events/ingest.ts`)

The Luma-origin downgrade block currently sends `declined`:

```ts
if (nextLumaStatus === "declined") await sendBookingComms(prior.id, "declined");
```

Becomes — notify the assigned expert (if any) of the guest cancellation:

```ts
if (nextLumaStatus === "declined" && prior.booked_by_email) {
  await sendBookingComms(prior.id, "guest_cancelled");
}
```

- No expert assigned → no email (guest gets nothing regardless). Coworker cancels
  are silent.
- `applyLumaStatus` (Notion/cron origin) is **unchanged** — still sends `declined`.
- Waitlist behavior is unchanged.

## Testing

- Templates: `guest_cancelled__helper` renders "has cancelled their booking" (no
  "capacity"); `renderComms("guest_cancelled", "guest", …)` returns `null` (no
  guest template); `declined__*` still render "reached capacity".
- Ingest routing: a Luma-origin decline of an **assigned** booking sends
  `guest_cancelled`; of an unassigned/coworker booking sends nothing; a
  Notion-origin decline still sends `declined` (unchanged).

## Rollout

1. Apply migration `0045`.
2. Deploy code.

## Open risks

- **Decline-in-Luma mislabel:** if the team ever declines a guest directly in Luma
  (not Notion), it arrives Luma-origin and is treated as a guest cancellation.
  Accepted per the team's Notion-triage workflow.
