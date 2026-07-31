# Booking Comms Email — Design

**Date:** 2026-07-31
**Status:** Approved (revised to fold in the original Notion agent instructions)

## Goal

Send transactional emails **and a calendar invite** directly from the hub when a
booking reaches a final state (Assigned / Checked In / No-show), replacing the
abandoned Notion-agent approach. This spec ports the full behavior that was
written as instructions for the "Office Hours Booking Messenger" Notion agent
(overview, field mapping, per-status messages, templates, calendar invite, and
edge cases) into hub-native code.

## Background / why not the Notion agent

Spike (2026-07-31): custom-agent mentions are stripped from the Notion public
API's comment rich text; the agent isn't in `/v1/users`; there's no way to
construct/replay an agent mention via the API, and the manual mention didn't fire.
Approach abandoned. The agent's *intent* is preserved here; only the execution
moves to the hub.

## Mapping the agent's trigger to hub code

The agent ran when the row's `Automation: Send comms` checkbox flipped, then used
the row's current `Status` to decide what to send. The hub has no such checkbox —
it fires directly from the code path that performs each transition:

| Agent trigger (Status when "Send comms" checked) | Hub trigger point |
|---|---|
| `Assigned` | `app/api/webhooks/notion/[workspace]/route.ts` claim path, after `claimBooking` + `pushBookingToWorkspaces` |
| `Checked In` | `app/api/webhooks/luma/route.ts` after `checkInByLumaGuestId` |
| `No-show` | `app/api/cron/no-show/route.ts` after `markNoShowsForEndedSlots` (per swept booking) |
| anything else (e.g. Cancelled) | no send |

`event_kind` values map to `booking_status`: `assigned`, `checked_in`, `no_show`.

## Delivery

- **Email provider:** Resend (`resend` npm package). Re-introduces the module
  removed in commit 260dd0e.
- **Sender domain:** a domain the user controls (acquired as Step 0), verified in
  Resend (DKIM/SPF). `makenotion.com` is not usable (no DNS control).
- **Calendar:** an `.ics` invite (`METHOD:REQUEST`) generated in code and attached
  to the Assigned emails — no Google OAuth. Organizer = `COMMS_FROM`; attendees =
  helper + guest; both can accept and it holds the slot.
- **Env:** `RESEND_API_KEY`, `COMMS_FROM` (e.g. `Office Hours <hello@domain>`),
  optional `COMMS_REPLY_TO`, `COMMS_ENABLED` (kill-switch; when false → record
  `skipped`, don't send).

## Recipients (reconciled)

The agent doc is helper-centric in the per-status sections but its overview + the
calendar attendee list intend both people. Reconciled with the earlier decision
in this project (guest only on Assigned):

- **assigned** → email **helper** (if `booked_by_email` present) **and guest**;
  both emails carry the `.ics` invite (both are attendees).
- **checked_in** → email **helper only**.
- **no_show** → email **helper only**.
- Never email anyone other than the helper (`booked_by_email`) and guest
  (`guest_email`). If the helper email is missing, skip the helper send (and log);
  guest still gets the Assigned email if guest email is present.

## Field mapping (from `booking_details`)

Required for a full send: `booked_by_display_name` + `booked_by_email` (helper),
`guest_email`, `slot_name`, `event_date`, `location`.
Core fields: `guest_name`, `guest_email`, `challenge`, `slot_name`, `event_date`,
`location`, `booked_by_display_name`.
Optional (include in the details block if present): `role`, `company`,
`guest_phone`, `event_name`.

## Guest details block (shared by all emails)

```
Guest Name: {guest_name}
Guest Email: {guest_email}
Challenge: {challenge}
Date: {event_date}
Time Slot: {slot_name}
Location: {location}
Role: {role}            (omit line if absent)
Company: {company}      (omit line if absent)
Guest phone: {guest_phone}  (omit line if absent)
Event: {event_name}     (omit line if absent)
```

## Message templates (ported verbatim from the agent)

**Assigned confirmation — to helper**
- Subject: `Office Hours booking confirmed — {guest_name}`
- Body: `Hi {booked_by_display_name},` / `Your Office Hours booking has been
  confirmed.` / {guest details block} / `A calendar hold has been added for the
  scheduled time.` / `Thanks,`

**Assigned confirmation — to guest** (guest-appropriate variant of the same)
- Subject: `Your Office Hours slot is confirmed — {event_date}`
- Body: `Hi {guest_name},` / `Your Office Hours slot is confirmed with
  {booked_by_display_name}.` / {guest details block} / `A calendar invite is
  attached.`

**Checked in — to helper**
- Subject: `Guest checked in: {guest_name}`
- Body: `Hi {booked_by_display_name},` / `Your guest has arrived and has been
  marked as checked in.` / {guest details block}

**No-show — to helper**
- Subject: `No-show: {guest_name}`
- Body: `Hi {booked_by_display_name},` / `This booking has been marked as a
  no-show.` / {guest details block}

Each email is rendered as both HTML and plain text.

## Calendar invite (`.ics`, Assigned only)

Generated in code and attached to both Assigned emails:
- **UID:** stable per booking — `booking-{booking.id}@officehours` — so re-sends
  and updates dedupe in calendar clients; `SEQUENCE` starts at 0.
- **METHOD:** `REQUEST`. **ORGANIZER:** `COMMS_FROM` address.
- **ATTENDEE:** helper email (required) + guest email (required); both `RSVP=TRUE`.
- **DTSTART:** `slot_starts_at`. **DTEND:** `slot_ends_at` if present and
  parseable, else `DTSTART + 30 min` (agent default is 30 min when ambiguous).
- **SUMMARY:** `Office Hours — {guest_name}`.
- **LOCATION:** `location`.
- **DESCRIPTION:** the guest details block (incl. optional fields).
- If `slot_starts_at`/`event_date` can't be parsed into a concrete time, **skip
  the `.ics`** but still send the confirmation email(s), and log the ambiguity to
  `sync_log` (mirrors the agent's "notify Booked by, still send confirmation").

## Idempotency

New table `email_log`:
- `id uuid pk default gen_random_uuid()`
- `booking_id uuid not null references bookings(id) on delete cascade`
- `event_kind text not null`  (`assigned` | `checked_in` | `no_show`)
- `recipient_role text not null`  (`helper` | `guest`)
- `recipient_email text not null`
- `resend_id text` (null if failed/skipped)
- `status text not null`  (`sent` | `failed` | `skipped`)
- `created_at timestamptz not null default now()`
- **`unique (booking_id, event_kind, recipient_role)`** — hard backstop against
  webhook retries / cron re-runs.
- RLS enabled, no policies (service-role only).

Per recipient: check `email_log`; if a row exists for
`(booking, event_kind, role)`, skip. Otherwise send, then record `sent` (with
`resend_id`) / `failed`. The unique index makes a lost race a 23505 → treat as
already-handled. A later genuine transition is a different `event_kind`, so it is
not blocked. The `.ics` stable UID prevents duplicate calendar holds even if a
client re-processes.

## Modules / files

- `lib/email/resend.ts` — Resend client + `sendEmail({to, subject, html, text,
  attachments?})` → `{id}` or throws.
- `lib/email/ics.ts` — pure `buildInvite(booking) → string` (VCALENDAR text) +
  helper to wrap as a Resend attachment. Unit-testable.
- `lib/email/templates.ts` — pure `renderComms(kind, role, booking) → { subject,
  html, text } | null` and `guestDetailsBlock(booking)`. No I/O.
- `lib/email/comms.ts` — `sendBookingComms(booking, kind)`: recipient selection,
  render, attach `.ics` on assigned, dedup via `email_log`, send, record. Returns
  a summary; never throws.
- `lib/db/email-log.ts` — `email_log` data access (service-role).
- `supabase/migrations/0005_email_log.sql` — the table above.
- `lib/env.ts` `env.comms.*` getters; `.env.example` documented.

## Error handling

Best-effort, non-blocking. `sendBookingComms` catches everything, records
`failed`/`skipped` in `email_log`, logs to `sync_log`, returns normally so the
booking sync is never broken. Missing required fields → skip that recipient + log
what's missing. `COMMS_ENABLED=false` short-circuits (records `skipped`).

## Testing

- Unit: `renderComms` for every kind×role (subjects/bodies/nulls); the guest
  details block (optional-field omission); recipient selection (helper skipped
  when unassigned, guest only on assigned); `.ics` builder (UID stability,
  DTSTART/DTEND, attendees, 30-min default, skip on unparseable time);
  idempotency decision against a mocked `email_log`.
- Integration: one real Resend send (with `.ics`) to the user's inbox before the
  triggers are wired live; verify the invite renders and `email_log` is written.
- Keep existing suite green.

## Setup (Step 0, outside code)

1. Register a small domain.
2. Verify it in Resend (add DKIM/SPF/DMARC records).
3. Create a Resend API key; set `RESEND_API_KEY`, `COMMS_FROM` in `.env.local` +
   Vercel.
