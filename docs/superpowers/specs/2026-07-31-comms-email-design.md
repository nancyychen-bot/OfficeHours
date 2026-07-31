# Booking Comms Email — Design

**Date:** 2026-07-31
**Status:** Approved

## Goal

Send transactional emails directly from the hub when a booking reaches a final
state (Assigned / Checked In / No-show), replacing the abandoned Notion-agent
approach (the public Notion API cannot mention a custom agent, and the agent's
@mention trigger did not fire). The hub already detects these transitions, so no
Notion comment or synced-DB trigger is involved.

## Background / why not the Notion agent

Spike (2026-07-31) proved: custom-agent mentions are stripped from the Notion
public API's comment rich text; the agent is not in `/v1/users`; there is no way
to construct or replay an agent mention via the API. Manual mention also failed
to fire. Approach abandoned. Comms now sent from the hub via Resend.

## Delivery

- **Provider:** Resend (`resend` npm package). Re-introduces the module removed
  in commit 260dd0e; reference the prior `lib/email/resend.ts` + templates.
- **Sender domain:** a domain the user controls (acquired as Step 0 of the
  plan), verified in Resend with DKIM/SPF. `makenotion.com` is not usable (no DNS
  control).
- **Env:** `RESEND_API_KEY`, `COMMS_FROM` (e.g. `Office Hours <hello@domain>`),
  optional `COMMS_REPLY_TO`, `COMMS_ENABLED` (kill-switch; when false, log and
  skip actually sending).

## Content matrix (approved)

Event kinds map to `booking_status` values: assigned → `assigned`, checked_in →
`checked_in`, no_show → `no_show`.

| Event | Helper (only if claimed) | Guest |
|---|---|---|
| **assigned** | "You claimed **{guest}**'s slot — {slot}, {date}, {city}. Challenge: {challenge}." | "Your slot is confirmed: {slot}, {date}, {city} with **{helper}**." |
| **checked_in** | "**{guest}** just checked in for your {slot} slot." | — (none) |
| **no_show** | "**{guest}** didn't show for the {slot} slot." | — (none) |

- Guest receives **only** the `assigned` email.
- Helper emails send **only** when the booking is claimed (`booked_by_email` is
  set, captured at claim time). If unassigned, the helper email is skipped.
- Helper email source: `bookings.booked_by_email`. Guest email: `guest_email`.
- Fields available for templates come from `booking_details` (guest_name,
  guest_email, company, role, challenge, location, event_name, event_date,
  slot_name, booked_by_display_name).
- Final-state only. No reminder/pre-event emails in v1.

## Trigger points (hub code the transition already flows through)

- **assigned** — `app/api/webhooks/notion/[workspace]/route.ts` claim path, after
  `claimBooking` succeeds and `pushBookingToWorkspaces`. Send for the claimed
  booking (works regardless of which workspace claimed).
- **checked_in** — `app/api/webhooks/luma/route.ts` after
  `checkInByLumaGuestId` returns the updated booking.
- **no_show** — `app/api/cron/no-show/route.ts` after
  `markNoShowsForEndedSlots` returns the swept bookings (one send per booking).

Each call site invokes `sendBookingComms(booking, kind)` best-effort (awaited but
its failure never throws out of the handler).

## Idempotency

New table `email_log`:
- `id uuid pk default gen_random_uuid()`
- `booking_id uuid not null references bookings(id) on delete cascade`
- `event_kind text not null`  (`assigned` | `checked_in` | `no_show`)
- `recipient_role text not null`  (`helper` | `guest`)
- `recipient_email text not null`
- `resend_id text` (null if send failed / skipped)
- `status text not null` (`sent` | `failed` | `skipped`)
- `created_at timestamptz not null default now()`
- **`unique (booking_id, event_kind, recipient_role)`** — hard backstop against
  webhook retries / cron re-runs double-sending.
- RLS enabled, no policies (service-role only, like the other tables).

Flow per recipient: attempt `insert` of a `sending` sentinel (or check-then-send
guarded by the unique index) → send via Resend → update row with `resend_id` +
`status='sent'`. On unique-violation (23505), another run already handled it →
skip. On send error, record `status='failed'` (keeps the unique slot so we don't
spam retries; a failed send is surfaced in `sync_log` for visibility).

A genuine later transition is a different `event_kind`, so it is not blocked.

## Modules / files

- `lib/email/resend.ts` — Resend client factory (reads `RESEND_API_KEY`); a
  `sendEmail({to, subject, html, text})` wrapper returning `{id}` or throwing.
- `lib/email/templates.ts` — pure functions: `renderComms(kind, role, booking) →
  { subject, html, text } | null` (null when that kind×role has no email).
  Fully unit-testable, no I/O.
- `lib/email/comms.ts` — `sendBookingComms(booking, kind)`: determines recipients
  (helper if `booked_by_email`; guest per matrix), renders, dedups via
  `email_log`, sends, records. Returns a summary; never throws.
- `lib/db/email-log.ts` — data access for `email_log` (has-been-sent check +
  record). Service-role client.
- `supabase/migrations/0005_email_log.sql` — the table above.
- Env getters in `lib/env.ts` (`env.comms.*`), `.env.example` documented.

## Error handling

Best-effort, non-blocking. `sendBookingComms` catches all errors internally,
records `failed`/`skipped` in `email_log`, logs to `sync_log`, and returns
normally so the booking sync is never broken. `COMMS_ENABLED=false` short-circuits
sending (records `skipped`).

## Testing

- Unit: `renderComms` for every kind×role (subject/body content, correct nulls);
  recipient selection (skip helper when unassigned, guest only on assigned);
  idempotency decision against a mocked `email_log`.
- Integration: one real Resend send to the user's inbox (dry gate) before the
  triggers are wired live; verify `email_log` row written.
- Keep existing suite green.

## Setup steps (Step 0, outside code)

1. Register a small domain (e.g. Cloudflare/Namecheap).
2. Add domain in Resend; add the DKIM/SPF/DMARC DNS records it provides; verify.
3. Create a Resend API key. Set `RESEND_API_KEY`, `COMMS_FROM` in `.env.local` +
   Vercel.
