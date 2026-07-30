# Design: Event-Day Loop (Luma guest lifecycle → hub)

**Status:** Approved (brainstorm) — 2026-07-30
**Phase:** Handle the full Luma guest lifecycle in the hub — approval gating, cancellation, and check-in notification — completing PRD §9–10.

## Goal

Only vetted (approved) guests become bookable records; when an approved guest cancels, the slot frees and the assigned helper is told; when a guest checks in at the door, the assigned helper is notified (Notion + email). This closes the event-day experience so helpers only work real, present guests.

## Context / current state

- Luma webhook (`app/api/webhooks/luma/route.ts`) currently upserts a booking on ANY `guest.registered`/`guest.updated`, and flips Status→Checked In from the per-ticket `checked_in_at`. It does NOT gate on approval, handle cancellation, or notify anyone.
- Check-in already mirrors Status→Checked In to both Notion DBs via `pushBookingToWorkspaces`.
- Helpers are native `Booked by` Person only in the workspace they claimed from; the hub stores `booked_by_display_name` + `booked_by_type` but NOT the helper's email.
- Office Hours events will have Luma **"Require approval" ON** — the organizer approves/declines each registrant (reading their challenge) in Luma's native UI.

## Decisions (from brainstorm)

1. **Approval gate in Luma; hub ingests only approved** (Option 1). The organizer approves in Luma. The hub creates a booking only when `approval_status = approved`. Pending/waitlist/invited are ignored. (A hub-side approval/triage screen is deferred to the admin-UI phase.)
2. **Cancellation** (`declined`, or guest cancels): the booking becomes `cancelled` (new booking_status), its `slot_id` is nulled (slot freed), both Notion pages are archived, and — if it was assigned — the assigned helper gets a cancellation email. Cancelled rows are kept for reporting (they were real, approved bookings).
3. **Check-in notification via two channels:** (A) native Notion "notify person" automation per workspace (no-code, organizer sets up), and (C) a hub-sent email to the assigned helper via **Resend**.
4. **Helper email captured at claim time** from their Notion `Booked by` Person (requires "Read user information → with email addresses" capability), stored in a new `booked_by_email` column.
5. **Best-effort notifications** — email/Notion failures never break the webhook; failures are logged to `sync_log`.

## Non-goals (deferred)

- Hub-side approval/triage screen → admin-UI phase (flag as a required screen for that design).
- Guest-facing emails (claim confirmation, day-of reminder — PRD §10) → later.
- Slack notifications.

## Validation prerequisite

Before layering check-in email on the Luma path, confirm a **real Luma RSVP** flows end-to-end: RSVP on the "Office Hours (Test)" event → booking appears in Supabase with company/challenge/matched slot → mirrored to both Notion DBs → clean `sync_log`. This is the first task in the plan.

---

## Section 1 — Luma guest lifecycle

Rework the Luma handler to branch on `data.approval_status` (plus existing check-in detection). `normalizeGuest` gains an `approvalStatus` field parsed from `data.approval_status`.

- **`approved`** → upsert booking as today (resolve event via allowlist, match slot, store guest fields). The gate: only approved become bookings.
- **`pending_approval` | `waitlist` | `invited`** → no booking; `logSync` `ignored` ("pending approval"). If a booking already exists for this guest (e.g. re-review), leave it unchanged.
- **`declined`** → cancellation path:
  - Find the booking by `luma_guest_id`. If none, log `ignored` and stop.
  - If it was assigned (`booked_by_email` present), send `cancellationEmail` to the helper (best-effort).
  - Set booking `status = cancelled`, `slot_id = null` (frees the slot).
  - Archive both Notion pages (`in_trash: true`) so it leaves every board.
  - `logSync` `applied` / `cancelled`.
- **Check-in** (any `data.event_tickets[].checked_in_at` set) → Section 3.

**Slot contention edge case:** bookings now materialize at approval time, so two approved guests could want the same slot. `upsertBookingFromLuma` must tolerate a taken slot — on the unique-violation (or a pre-check that the slot is free), create/keep the booking with `slot_id = null` and log a note so the organizer can assign a slot manually, rather than throwing.

**Data model:** add `cancelled` to the `booking_status` enum (migration).

---

## Section 2 — Capture helper email at claim

- **Migration:** add nullable `booked_by_email text` to `bookings`.
- **Capability:** enable "Read user information → with email addresses" on both Notion integrations (one-time org action).
- **Mapper:** add `readFirstPersonEmail(property)` → `people[0].person?.email ?? null` (sibling of `readFirstPersonName`).
- **Claim path (`app/api/webhooks/notion/[workspace]/route.ts`):** after `claimBooking` succeeds, read the Person email from the already-fetched page and persist via a new `setBookedByEmail(bookingId, email)` in `lib/db/bookings.ts`. Only write when non-null.
- **Graceful:** capability off / email absent → `booked_by_email` stays null → check-in email skipped; Notion notification still fires.

---

## Section 3 — Notifications

**Channel A — Notion (no-code, organizer sets up).** Per Bookings DB: database automation "when `Status` → `Checked In`, notify the `Booked by` person." The hub's Status write triggers it; only the claiming workspace has a Person to notify. Documented as click-steps in `docs/NOTION_CHECKIN_AUTOMATION.md`.

**Channel C — Hub email (Resend).**
- `lib/email/resend.ts` — `sendEmail({ to, subject, text }): Promise<void>` using `RESEND_API_KEY`, `from = env EMAIL_FROM`. Wrapped by callers in try/catch.
- `lib/email/templates.ts` — pure builders returning `{ subject, text }`:
  - `checkInEmail(input)` — "Your Office Hours guest just checked in": guest name, company, slot label, challenge.
  - `cancellationEmail(input)` — "Your Office Hours 1:1 was cancelled": guest name, slot label.
- **Check-in trigger (Luma handler):** `checkInByLumaGuestId` returns a row ONLY on the actual transition to Checked In (filters `status != checked_in`). Send the check-in email only when it returns a row AND `booked_by_email` is set. Natural idempotency against Luma re-delivery.
- **Cancellation trigger:** Section 1 decline path, when `booked_by_email` present.
- **Env:** `RESEND_API_KEY`, `EMAIL_FROM` (default `onboarding@resend.dev` for testing) added to `.env.example`, `.env.local`, Vercel.

**Testing note:** Resend test mode delivers only to the account owner's address; during testing the helper = `nchen@makenotion.com`, From = `onboarding@resend.dev`. Switch `EMAIL_FROM` to the verified Community address later.

---

## Components touched

| Area | Change |
|---|---|
| `supabase/migrations/` | add `cancelled` to `booking_status`; add `bookings.booked_by_email` |
| `lib/supabase/types.ts` | reflect the enum value + column |
| `lib/luma/parse.ts` / `types.ts` | expose `approvalStatus` on the normalized guest |
| `lib/db/bookings.ts` | `cancelBooking` (status=cancelled + slot_id null), `setBookedByEmail`; slot-taken tolerance in `upsertBookingFromLuma` |
| `lib/notion/mappers.ts` | `readFirstPersonEmail` |
| `lib/notion/push.ts` | archive-pages helper for cancellation (or reuse) |
| `lib/email/resend.ts` (new) | `sendEmail` |
| `lib/email/templates.ts` (new) | `checkInEmail`, `cancellationEmail` (pure) |
| `app/api/webhooks/luma/route.ts` | approval branch, cancellation path, check-in email |
| `app/api/webhooks/notion/[workspace]/route.ts` | capture helper email on claim |
| `lib/env.ts`, `.env.example` | `RESEND_API_KEY`, `EMAIL_FROM` |
| `docs/NOTION_CHECKIN_AUTOMATION.md` (new) | Notion notify-person setup guide |

## Testing

- Pure email templates — subject/body contain guest name, slot, company, challenge (unit).
- `normalizeGuest` exposes `approvalStatus` correctly (unit).
- Approval branch logic (pure decision helper `lifecycleAction(approvalStatus)` → `"create" | "ignore" | "cancel"`) — unit-tested independent of DB. (Check-in is handled orthogonally within the `create` path.)
- Check-in idempotency: second identical check-in does not re-send (relies on `checkInByLumaGuestId` transition semantics; assert the handler only emails when a row is returned).
- Manual: real RSVP (validation prereq); approve in Luma → booking appears; decline → cancelled + slot freed + Notion archived + helper emailed; check-in → helper emailed + Notion notified.

## Success criteria

- Pending registrants never create bookings; only approved do.
- A declined/cancelled approved booking frees its slot, disappears from Notion, and (if claimed) emails the helper.
- A door check-in notifies the assigned helper via Notion and email, exactly once.
- Everything degrades gracefully — a Resend/Notion failure never blocks the Luma webhook.
