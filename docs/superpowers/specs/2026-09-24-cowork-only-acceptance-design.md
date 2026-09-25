# Cowork-only acceptance — design

**Date:** 2026-09-24
**Status:** Approved for planning

## Problem

Volunteers claim 1:1 registrants first. Organizers then review the registrants
nobody claimed. Today those unclaimed, still-`pending` registrants get
auto-declined at the day-before cutoff. We want a way for an organizer to instead
**accept a good-fit unclaimed registrant for coworking only** — approving their
attendance without a 1:1 — and send them one clear email saying so.

Coworking does **not** guarantee a 1:1 session.

## User story

As an organizer, I want to accept a good-fit registrant for coworking when they
did not receive a 1:1 match, so they can still attend instead of being declined.

## Workflow

1. Volunteers claim 1:1 registrants first (existing flow, unchanged).
2. Organizers review remaining unclaimed registrants in the Notion Dev bookings DB.
3. An organizer clicks **Cowork only** on an eligible unclaimed registrant.
4. The registrant's status changes to **Cowork only**.
5. The system sends exactly one cowork-only acceptance email.
6. The existing cutoff automation declines the remaining unclaimed registrants —
   but never the cowork-only ones.

## Decisions (confirmed)

- **Email:** new dedicated template, separate from the existing `cowork_only`
  notice.
- **Status:** a distinct `cowork_only` state (not a reuse of `no_help_needed`).
- **Luma:** accepting for cowork also approves the guest in Luma.
- **Surface:** Notion **Dev** workspace only (organizer-facing), via the existing
  Notion→hub webhook button pattern.

## Existing system (relevant facts)

- `bookings.status` enum: `unassigned | assigned | no_help_needed | checked_in |
  no_show | cancelled` (`supabase/migrations/0001_initial_schema.sql`, extended by
  0003/0009).
- `bookings.luma_status` enum: `pending | approved | waitlist | declined`.
- **Claim** (`claimBooking`, `lib/db/bookings.ts`) only succeeds on
  `status='unassigned'` AND `filtered=false`, via a single conditional UPDATE
  (first-wins race guard).
- **Cutoff auto-decline** (`lib/events/decline-pending.ts`) selects declinable
  guests purely by `luma_status === 'pending'`
  (`selectDeclinablePendings`); runs day-before at 08:00 local via the hourly
  `/api/cron/decline-pending`.
- **Email** templates live in `lib/email/templates.ts` (`TEMPLATE_REGISTRY`,
  overridable via the `email_overrides` table). Sending goes through
  `sendBookingComms(bookingId, kind)` (`lib/email/comms.ts`), which renders event
  placeholders and dedups via the `email_log` table (unique on
  `booking_id + event_kind + recipient_email`, reserved atomically by
  `reserveCommsSlot`).
- **Notion buttons** already work by a "Send webhook" action POSTing to
  `/api/webhooks/notion/[workspace]` with an `x-action` header
  (`claim` / `unclaim` / `reassign`), authed by `x-webhook-secret`, matched to a
  booking through the stored `notion_dev_page_id` / `notion_ambassador_page_id`.
- **Luma writeback** uses `updateGuestStatus` (`lib/luma/client.ts`); approving
  sends Luma's own confirmation/ticket email (`send_email: true`).
- An existing `cowork_only__guest` template + `isCoworkOnlyMismatch` predicate
  handle a *different* case: a guest who never booked a slot. That stays as-is.

## Design

### 1. New `cowork_only` status

- Add `cowork_only` to the `booking_status` enum (new migration).
- Add `'cowork_only'` to the `BookingStatus` type in `lib/sync/types.ts`.
- Add a **"Cowork only"** option to the Notion Status select mapping in
  `lib/notion/schema.ts` and `lib/notion/mappers.ts`.
- Treat `cowork_only` as a **sibling of `no_help_needed`** ("attending, no 1:1")
  wherever downstream code branches on "no 1:1" — check-in (`nohelp` variants),
  no-show, day-of/agenda, and prep-reminder audiences. Audit these branches so
  `cowork_only` is handled identically to `no_help_needed` except where an
  organic-vs-accepted distinction is explicitly wanted (reporting).

### 2. Trigger — Notion webhook action

- Add an `x-action: "cowork_only"` branch to
  `app/api/webhooks/notion/[workspace]/route.ts`.
- Reuse the existing auth (`x-webhook-secret`), page-id extraction
  (`body.data.id`), settle delay, and booking resolution by Notion page id.
- Dev-only: the button is created only in the Dev bookings DB, so the Ambassador
  workspace never triggers it. No per-workspace code gating needed beyond that.

### 3. Accept flow — `acceptCoworkOnly(bookingId)` (`lib/db/bookings.ts`)

Ordered steps:

1. Load booking; validate eligibility (see §4).
2. **Atomic transition:** `UPDATE bookings SET status='cowork_only',
   luma_status='approved' WHERE id=$1 AND status='unassigned'`. The
   `WHERE status='unassigned'` clause is the race guard against a simultaneous
   1:1 claim — first writer wins.
3. Send `cowork_only_accept` comms via `sendBookingComms` — dedup'd by
   `email_log`, so exactly one email.
4. Best-effort Luma writeback: `updateGuestStatus(..., 'approved', ...)` so the
   guest keeps a ticket and leaves the pending pool at the source. Errors are
   logged, not fatal.
5. Mirror to both Notion workspaces via `pushBookingToWorkspaces`.
6. Log the action (`sync_log`, action `cowork_only_accept`).

Return a small result discriminating `accepted` / `noop` / `rejected`
(with reason) so the caller can log outcomes.

### 4. Eligibility & idempotency (enforced server-side)

- **Eligible:** `status='unassigned'` and not declined/cancelled.
- **`assigned`** → **rejected** ("has a 1:1 — unclaim first"), logged; no email.
- **Already `cowork_only`** → **no-op**: the `WHERE status='unassigned'` guard
  makes the UPDATE affect zero rows, so no transition; the `email_log` unique
  constraint blocks any second email. Repeated clicks send nothing and insert no
  new rows.

This satisfies: one action, exactly one email, no duplicate emails, no duplicate
records, and no accidental 1:1 claim of a cowork-only registrant.

### 5. Auto-decline exclusion

- Setting `luma_status='approved'` already removes the registrant from
  `selectDeclinablePendings` (pending-only).
- Belt-and-suspenders: also add `&& b.status !== 'cowork_only'` to
  `selectDeclinablePendings`, so a cowork-only registrant is never declined even
  if their `luma_status` is somehow still pending.

### 6. Exception override

- An organizer can deliberately change the Notion Status back to "Unassigned" to
  re-open a registrant for 1:1. The Luma-webhook state machine
  (`decideBookingStatusPatch`) must keep `cowork_only` **sticky** against
  incoming approved/pending webhooks (no silent revert) while still honoring a
  deliberate manual status edit and a decline/cancel (→ released/cancelled).

### 7. Email — `cowork_only_accept__guest`

- New key in `TemplateKey` + `TEMPLATE_REGISTRY` (`lib/email/templates.ts`); new
  `cowork_only_accept` kind in `lib/email/comms.ts` with recipients `["guest"]`.
- Reuses existing event placeholders (`{{firstName}}`, `{{location}}`,
  `{{eventDate}}`, `{{eventUrl}}`, `{{eventInstructions}}`, signoff, support).
- Core message: *"We're at capacity for 1:1 sessions, but we'd love to have you
  cowork with us."* Must explicitly state that coworking does **not** include a
  guaranteed 1:1 session.
- Kept distinct from the existing `cowork_only` notice ("a 1:1 slot wasn't
  selected during registration"), which is a different situation and unchanged.

### 8. Logging

- Email send → `email_log` (existing).
- Status change → `sync_log` entry, action `cowork_only_accept` (existing
  `logSync` mechanism).

## Files touched

- `supabase/migrations/00XX_booking_status_cowork_only.sql` — new enum value
  (number past the remote max; apply via `apply_migration`).
- `lib/sync/types.ts` — `BookingStatus` union.
- `lib/db/bookings.ts` — `acceptCoworkOnly`; keep `cowork_only` sticky in
  `decideBookingStatusPatch`.
- `lib/notion/schema.ts`, `lib/notion/mappers.ts` — "Cowork only" ↔ `cowork_only`.
- `lib/email/templates.ts`, `lib/email/comms.ts` — new template + kind.
- `app/api/webhooks/notion/[workspace]/route.ts` — `x-action: "cowork_only"`.
- `lib/events/decline-pending.ts` — exclude `cowork_only` from declinable set.
- Audit downstream status branches (check-in, no-show, agenda, prep audience) to
  treat `cowork_only` like `no_help_needed`.
- Tests for: atomic transition + race, eligibility (unassigned/assigned/already),
  idempotent email, auto-decline exclusion, sticky status against webhooks.

## Manual setup (not code)

- Add a **"Cowork only"** option to the Status select in the Notion Dev bookings
  database.
- Add a **"Cowork only"** database button (Send webhook → `/api/webhooks/notion/dev`,
  header `x-action: cowork_only`, plus the existing `x-webhook-secret`) in the Dev
  bookings DB, mirroring the existing claim/unclaim buttons.

## Acceptance criteria

- Organizers can identify all unclaimed registrants (existing views).
- One action accepts an eligible registrant; status becomes **Cowork only**.
- Exactly one cowork-only email is sent; a second click does not resend it.
- Cowork-only registrants are excluded from automatic decline.
- Cowork-only registrants cannot be claimed for 1:1 through the volunteer flow.
- Existing claimed / declined / unclaimed workflows continue working.

## Out of scope (YAGNI)

- A hub web-app button (Notion Dev only for now).
- Ambassador-workspace access to the action.
- Changing the existing `cowork_only` notice behavior.
