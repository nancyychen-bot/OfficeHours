# Guest-Cancelled vs. Organizer-Declined Emails — Design

**Date:** 2026-08-21
**Status:** Draft (awaiting user review)

## Problem

A booking reaching `luma_status = declined` currently fires one comms kind
(`declined`) with "we've reached capacity" wording, regardless of *why* it was
declined. In reality there are two very different causes:

1. **Guest cancels** — the guest sets themselves "Not Going" on Luma. Arrives via
   the **Luma webhook** (`guest.updated`, `approval_status: declined`). They should
   hear "your booking's been cancelled, thanks."
2. **Organizer declines** — the team sets *Luma Status → Declined* in **Notion**
   (e.g. at capacity / not a fit). Arrives via the **Notion webhook**. They should
   hear the "at capacity" note.

Today both produce the same "at capacity" email, which is wrong for the (far more
common) guest-cancellation case, and the expert's "slot freed" note also
mis-attributes the reason.

## Key insight: distinguish by origin

The two causes come in on **different code paths**, so we can route them:

| Cause | Inbound path | Comms kind |
|---|---|---|
| Guest cancels | Luma webhook → `ingestRegistration` (Luma-origin) | **`guest_cancelled`** (new) |
| Organizer declines | Notion webhook → `applyLumaStatus` (source `dev`/`ambassador`) | `declined` (existing, unchanged) |
| Hub day-before auto-decline | cron → `applyLumaStatus` (source `cron`) | `declined` (host-side) |

**Assumption (confirmed with user):** the team triages (approve/decline) in
**Notion**, not in Luma. So a Luma-origin `declined` is treated as a guest
cancellation. Luma's payload exposes only `approval_status: declined` with no field
distinguishing guest-not-going from host-declined-in-Luma, so origin is the only
signal — this assumption is what makes it reliable. (If the team ever declines a
guest directly in Luma, it would be labeled a guest cancellation.)

## Audience gate: only 1:1 bookings get the cancellation email

A guest who cancels but **never had a 1:1** (a coworker: no time slot, no expert,
`status = no_help_needed`) should get **nothing** — "your booking was cancelled"
doesn't fit someone who only RSVP'd to cowork, and it's needless email.

Gate on whether the booking was an actual 1:1, using the booking's **pre-cancel**
state (`ingestRegistration` sends before the upsert, so `prior` still holds it):

```
hadOneOnOne(booking) = !!booking.requested_slot || !!booking.booked_by_email
```

- Requested a slot (`requested_slot` set) → wanted a 1:1 → send.
- Was assigned an expert (`booked_by_email` set) → send (belt-and-suspenders).
- Coworker (`no_help_needed`, no slot) → skip entirely.

`hadOneOnOne` is a pure, unit-tested helper in `lib/events/cancellation.ts`.

## New comms kind: `guest_cancelled`

- **Recipients:** `["guest", "helper"]`. The helper leg only actually sends when
  `booked_by_email` is set (i.e. the 1:1 was claimed) — the existing recipient
  resolution skips a null helper — so an unclaimed-but-requested 1:1 emails only
  the guest. No extra handling needed beyond the audience gate above.
- **Calendar:** a `CANCEL_CALENDAR_KIND` — attaches the cancel `.ics` (same
  `UID:booking-<id>`) so a *claimed* 1:1 that the guest cancels removes the
  expert's calendar hold. No slot → `buildCancel` returns null → no attachment
  (harmless).
- **email_log migration** (`0045`) adds `guest_cancelled` to the `event_kind`
  check constraint (same pattern as prior kinds).

### Templates (approved via preview sends)

`guest_cancelled__guest`:
> **Subject:** Your Notion Build Bar booking has been cancelled
>
> Hi {{firstName}},
>
> Thanks for letting us know — your Notion Build Bar booking has been cancelled and
> your spot released. We're sorry to miss you this time!
>
> We'd love to build with you at a future event. Follow our Notion calendar so you
> don't miss the next one:
>
> 👉 {{calendarLink}}
>
> {{SUPPORT}}
>
> Thanks so much,
> {{SIGNOFF}}

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

`declined__guest` / `declined__helper` stay **unchanged** (the original "at
capacity" wording) — they now fire only on the organizer-decline path.

## Routing change (`lib/events/ingest.ts`)

The Luma-origin downgrade block currently sends `declined`:

```ts
if (nextLumaStatus === "declined") await sendBookingComms(prior.id, "declined");
```

Becomes — send the guest-cancellation comm, gated to 1:1s:

```ts
if (nextLumaStatus === "declined" && hadOneOnOne(prior)) {
  await sendBookingComms(prior.id, "guest_cancelled");
}
```

`applyLumaStatus` (Notion/cron origin) is **unchanged** — it keeps sending
`declined`. Waitlist behavior is unchanged.

## Testing

- Templates: `guest_cancelled__guest` renders the cancellation + thanks copy (no
  "capacity"); `guest_cancelled__helper` renders "has cancelled their booking";
  `declined__*` still render "reached capacity".
- `hadOneOnOne`: true for `requested_slot` set or `booked_by_email` set; false for a
  `no_help_needed` coworker with neither.
- Ingest routing: a Luma-origin decline of a 1:1 booking sends `guest_cancelled`;
  of a coworker sends nothing; a Notion-origin decline still sends `declined`
  (unchanged).

## Rollout

1. Apply migration `0045`.
2. Deploy code.
3. (Optional) preview sends of both `guest_cancelled` templates to the operator,
   already reviewed during design.

## Open risks

- **Decline-in-Luma mislabel:** if the team ever declines a guest directly in Luma
  (not Notion), it arrives Luma-origin and is labeled a guest cancellation. Accepted
  per the team's Notion-triage workflow.
