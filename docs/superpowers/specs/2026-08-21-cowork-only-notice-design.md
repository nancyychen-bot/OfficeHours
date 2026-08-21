# Cowork-Only Notice — Design

**Date:** 2026-08-21
**Status:** Draft (awaiting user review)

## Problem

Some guests select **"I need 1:1 help"** in their Luma registration reasons but
never book a time slot (and often leave the challenge blank). With no slot they
land as `status = no_help_needed` — there is nothing for a Notion expert to claim,
so they will **not** be paired for a 1:1. When an organizer approves them (to
cowork), nothing tells them this: they may arrive expecting dedicated one-on-one
help they were never queued for.

## Goal

When a qualifying guest is **approved**, automatically email them to set
expectations: they're welcome to cowork, but — because no time slot was selected —
they will not be paired 1:1 with a Notion expert. Also provide a one-off script to
backfill guests who were already approved before this shipped.

## Non-goals

- No path to *fix* the mismatch (no "book a slot now" link). Clarification only.
- No change to the assignment/approval model, slots, or claiming.
- Pure coworkers who never asked for 1:1, and guests who booked a slot, are not
  emailed.

## Audience — `isCoworkOnlyMismatch(booking)` (pure predicate)

A booking qualifies when **all** hold:

1. `status === "no_help_needed"` — no time slot was booked, so no 1:1 is possible.
2. `attend_reasons` contains `"1:1 help"` (case-insensitive substring; the Luma
   multi-select label is `"I need 1:1 help"`, stored comma-joined in
   `attend_reasons`).

The approval axis is handled by the trigger (fires only on transition to
`approved`), so the predicate itself only encodes the "asked for 1:1 but has no
slot" mismatch. Guests with a slot (`unassigned`/`assigned`) and pure coworkers
(no "1:1 help" reason) are excluded.

The predicate is pure and unit-tested, and lives in `lib/events/cowork-notice.ts`.

## The email — new comms kind `cowork_only`

- **Recipient:** `["guest"]` (add to `RECIPIENTS` in `lib/email/comms.ts`).
- **CommsKind:** add `"cowork_only"` to the union in `lib/email/templates.ts`;
  add template key `cowork_only__guest` + registry entry.
- **email_log migration:** new migration allowing the `cowork_only` `event_kind`
  (same pattern as `prep_reminder_day_before`, migration `0041`).
- **Subject:** `You're approved to cowork at the Notion Build Bar (no 1:1 slot booked)`
- **Body (draft — wordsmith freely):**
  > You've been approved to join us at the Notion Build Bar in {location} on
  > {eventDate} to **cowork** alongside Notion experts.
  >
  > One heads-up: because a 1:1 time slot wasn't selected during registration, you
  > **won't be paired with a Notion expert for dedicated one-on-one help**. You're
  > very welcome to come cowork, ask questions, and meet the team — we'd love to
  > have you.

  Uses the template fields already available to other guest emails
  (`location`, `eventDate`, etc. — mirror `prep_reminder__guest`).

## Trigger — on approval, inside `applyLumaStatus`

Approvals flow through the shared `applyLumaStatus` orchestrator
(`lib/sync/approval.ts`), which already sends `declined`/`waitlisted` comms on the
matching transitions. Add a parallel branch:

- When `next === "approved"` **and** `isCoworkOnlyMismatch(booking)` →
  `await deps.sendComms(booking.id, "cowork_only")`.

Notes:
- Covers the organizer's Notion "Luma Status → Approved" action (the primary path)
  and any other caller of `applyLumaStatus` uniformly.
- **No false fires on claim auto-approval:** a claim promotes `pending → approved`
  only for a booking that was just claimed (`status = assigned`), so the predicate
  (`status === "no_help_needed"`) is false.
- **Idempotent:** `email_log` dedups on (booking, `cowork_only`), so re-approvals
  never re-send.
- The predicate reads `booking.status` and `booking.attend_reasons` from the
  input booking (the approval transition does not change the assignment axis), so
  the check is correct even though `setLumaStatus` runs first.

To keep `applyLumaStatus` decoupled from the DB, the predicate is imported
directly (it's pure) — no new `ApplyDeps` field is needed.

## Backfill script — `scripts/send-cowork-notice.ts`

Mirrors `scripts/send-prep.ts`. Takes an event (id or the same selector
`send-prep` uses), loads its bookings, filters to `luma_status === "approved"` +
`isCoworkOnlyMismatch`, and calls `sendBookingComms(b.id, "cowork_only")` for each.
Run once now for the New York / Aug 28 event to catch already-approved guests;
`email_log` dedup makes re-runs safe. Add an npm script `send:cowork` alongside the
other `send:*` entries in `package.json`.

**Test-send gate (required before any real backfill):** the script supports a
`--test <email>` (or `TEST_EMAIL=`) mode that renders the `cowork_only` email for a
representative qualifying guest of the event and sends the single copy **only** to
that address (default the operator's own), touching no real guests and writing no
`email_log` rows for them. The operator reviews the real rendered email, and only
then runs the script without `--test` to send for real. This gates the actual
deploy/backfill on a human eyeballing the exact email first.

## Testing

- **Predicate** (`isCoworkOnlyMismatch`): true for `no_help_needed` + reasons
  containing "1:1 help"; false for a slot-booker (`unassigned`/`assigned`), for a
  `no_help_needed` guest without the "1:1 help" reason, and for empty/null
  `attend_reasons`. Case-insensitive match verified.
- **`applyLumaStatus`** (extend `tests/approval-apply.test.ts`): approving a
  mismatch booking calls `sendComms(id, "cowork_only")`; approving a slot-booker or
  a non-1:1 coworker does not; declining/waitlisting never sends `cowork_only`.
- **Template** (`tests/` comms templates): `cowork_only__guest` renders with a
  subject/body containing the coworking + no-1:1 message.

## Rollout

1. Apply the `email_log` migration.
2. Deploy code (predicate + `applyLumaStatus` branch + template + recipient).
3. **Test-send first:** run the backfill script in `--test` mode to send one
   rendered copy to the operator (nchen@makenotion.com) and confirm the email
   looks right.
4. After approval, run `npm run send:cowork` for the New York / Aug 28 event to
   backfill the already-approved guests.
5. Going forward, approving a qualifying guest in Notion sends the notice
   automatically.

## Open questions / risks

- **Reason label drift:** if the Luma form later changes "I need 1:1 help" wording,
  the `"1:1 help"` substring match must be updated. Low risk (form is finalized).
- **Copy tone:** subject is locked; body copy is a draft to refine during
  implementation.
