# Expert "Replace Your Booking" Nudge on Guest Cancel — Design

**Date:** 2026-08-24
**Status:** Draft (awaiting user review)

## Problem

When a guest self-cancels a **claimed** 1:1, the expert currently gets only the
`guest_cancelled` "slot freed" email — a dead end. Nothing nudges them to pick up a
replacement booking, so the freed capacity and the expert's willingness go to waste.

## Goal

On a guest self-cancel of a claimed 1:1, nudge the expert to **claim a replacement**,
delivered as **both** a Slack DM and the (existing) email, pointing them to their
**city's recruit Slack channel** (where open slots are already posted via
`postSlackRecruit`).

## Scope

- **Trigger:** guest self-cancel only — the existing `guest_cancelled` path in
  `ingestRegistration` (fires only when an expert was assigned, via
  `shouldSendGuestCancelled`). Organizer declines and expert self-unclaims are out.
- **Channels:** Slack DM **and** email (both carry the replace nudge).
- **Destination:** the cancelled booking's **city** Slack channel. We know the
  booking, so we know its city — no multi-event ambiguity.

## Components

### 1. Email — extend `guest_cancelled__helper` (`lib/email/templates.ts`)
Keep the existing "slot freed — {{guestName}} has cancelled" copy; add a nudge line.
Email can't reliably deep-link a Slack channel, so it names it generically (no new
template var):

> Hi {{firstName}},
>
> Quick update: {{guestName}} has cancelled their booking and won't be joining, so
> the slot you'd claimed has been released.
>
> Want to pick up another? Head to your city's Build Bar Slack channel to claim an
> open 1:1 — we'd love to keep you building.
>
> {{SUPPORT_HELPER}}
>
> Thanks for building with us,
> {{SIGNOFF}}

### 2. Slack DM — new `postGuestCancelledDM(bookingId)` (`lib/slack/notify.ts`)
Mirrors `postClaimConfirmDM`: best-effort, logged, never throws.

1. Load the booking; if no `booked_by_email`, return (no expert to notify).
2. Load booking details → `CommsFields` (for `guestName`, `location`/city).
3. Resolve the city channel: `getSlackChannelForCity(details.location)` →
   `{ channelId, channelName }` (or null).
4. Build blocks via a new `buildGuestCancelledBlocks(...)` (`lib/slack/blocks.ts`)
   modeled on `buildClaimConfirmBlocks`:
   - "**{guestName}**'s 1:1 was cancelled, so your slot just freed up."
   - If a channel resolved: a clickable mention `<#{channelId}>` — "Grab another open
     1:1 in <#…>." If not: a generic line ("check your city's Build Bar channel").
5. `dmByEmail(booking.booked_by_email, blocks, "A 1:1 slot just freed up")`.
6. `logSync({ action: "guest_cancelled_dm", ... })`.

### 3. Wire-up (`lib/events/ingest.ts`)
Immediately after the `guest_cancelled` email send, also fire the DM:
```ts
if (shouldSendGuestCancelled(prior, nextLumaStatus)) {
  await sendBookingComms(prior.id, "guest_cancelled");
  await postGuestCancelledDM(prior.id);
}
```

## Fallbacks (best-effort, matches `postClaimConfirmDM`)
- Expert not found on Slack (`users.lookupByEmail` miss) → DM skipped; the email
  still sends.
- City has no configured Slack channel → DM sends the nudge without a channel link.
- Any DM error is logged and swallowed; it never blocks the email or the ingest.

## Testing
- `buildGuestCancelledBlocks`: renders the guest name + a `<#channelId>` mention when
  a channel is given; renders the generic nudge (no mention) when channel is null.
- Email: `guest_cancelled__helper` renders the "pick up another" nudge (and still
  "cancelled their booking", no "at capacity").
- (Per codebase convention, `postGuestCancelledDM`'s orchestration is not
  module-mocked; the pure blocks builder carries the unit coverage — same as
  `postClaimConfirmDM`, which is untested at the orchestration layer.)

## Rollout
Deploy code. No migration. No new Notion/Luma config. Existing Slack app + city
channels already power the DM (same path as claim-confirm DMs and recruit posts).

## Open risks
- Depends on the expert's `booked_by_email` matching their Slack account email
  (already relied on by `postClaimConfirmDM`).
- A city with no `slack_channels` row gets a linkless nudge — acceptable; the email
  nudge still applies.
