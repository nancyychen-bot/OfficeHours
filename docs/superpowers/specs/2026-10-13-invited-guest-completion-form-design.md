# Invited-Guest Registration Completion — Design

**Date:** 2026-10-13
**Status:** Approved (design) — pending implementation plan

## Problem

When a host **invites** a guest directly on Luma, the guest can attend without
answering the Luma registration form. They still arrive via the `guest.registered`
webhook and become a booking row, but with **no form data**: `challenge`, `role`,
`company`, `experience_level`, `attend_reasons`, `requested_slot` are all null,
so `status = no_help_needed` and there is nothing for experts (or the Notion
databases) to work with.

We want to email these guests a link to complete the same registration form, and
write their answers back onto their existing booking (and mirror to both Notion
workspaces), moving them to a claimable 1:1 if they pick a slot.

## Goals

- Auto-detect invited (no-form) guests and email them a completion link — once.
- A tokenized web form that mirrors the event's **actual** Luma registration
  questions (including the slot dropdown and any custom/translated questions).
- Answers flow back through the **existing** `normalizeGuest → ingestRegistration`
  pipeline, so slot-matching, the `no_help_needed → unassigned` status flip, and
  dual-Notion sync are reused, not reimplemented.

## Non-goals (decided)

- **No Slack recruit post** on completion. A completed guest just becomes
  `unassigned` (claimable) and shows in the Unclaimed view; no Slack fired.
- **No confirmation email** after submit — on-page success message only.
- No VIP/speaker suppression for now (see Risks).

## Approach

Approach ① (chosen): **tokenized magic link + dynamic form mirroring the event's
Luma questions**, answers replayed through the normal ingest pipeline.

### 1. Detection + auto-send (Luma webhook / ingest)

- Pure helper `isInvitedGuest(norm: NormalizedRegistration): boolean` — true when
  the guest has **zero** mapped answers: no `requestedSlot`, `challenge`, `role`,
  `company`, `experienceLevel`, `attendReasons` (and no `notionPlan`).
- In `ingestRegistration` (live webhook only), after the upsert: if
  `isInvitedGuest(norm)` AND the booking's `luma_status === "approved"`, send the
  new `complete_registration` comms (guest recipient). **Not** for pending /
  waitlist / declined, and **not** during backfill (`opts.live === false`).
- Idempotency: the existing comms-ledger `reserve()` (email_log, keyed on
  booking+kind+recipient) guarantees exactly one send even across repeated
  `guest.updated` webhooks. A guest who later completes the form no longer matches
  `isInvitedGuest`, so there is no re-prompt regardless.

### 2. Tokenized link

- New `lib/auth/booking-token.ts`, reusing `lib/auth/token.ts` HMAC:
  - `issueBookingToken(bookingId, secret, nowMs): Promise<string>` → signs
    `booking.{bookingId}.{nowMs}`.
  - `verifyBookingToken(token, secret, nowMs): Promise<string | null>` → returns
    the bookingId, or null if the signature is bad, payload malformed, or older
    than **14 days** (`MAX_AGE_MS`).
- Secret: reuse an existing app secret (the form-token / app secret); no new env
  if one is already present, else add `BOOKING_TOKEN_SECRET`.
- URL: `${baseUrl}/complete-registration/{token}`.

### 3. The form

- Route `app/complete-registration/[token]/page.tsx` (client), modeled on
  `app/change-slot/page.tsx`.
- **Load API** `app/api/complete-registration/load/route.ts` (POST `{token}`):
  verify token → load booking + event → fetch the event's Luma
  `registration_questions` via `getLumaEvent(owning-calendar key)` and the hub's
  slots → return `{ questions, slotOptions, prefill }`. The page renders the
  questions dynamically (text inputs; single-selects for option questions; the
  slot dropdown from the clock-time options via `extractSlotOptions`).
- **Submit API** `app/api/complete-registration/submit/route.ts` (POST
  `{token, answers}`): verify token → reconstruct a Luma-shaped
  `registration_answers` array from the inputs → build a `LumaGuestData` using the
  booking's `luma_guest_id`, `guest_email`, and the event's `luma_event_id` →
  `normalizeGuest()` → `ingestRegistration(norm, { live: false })`.
  - `live:false` keeps it silent (no assignment emails) while still upserting the
    booking (status flips to `unassigned` if a slot was picked) and pushing to
    both Notion workspaces.
  - Returns `{ ok, eventName }` for the success screen.

### 4. New `complete_registration` comms kind

Per the comms-kind rule (template + RECIPIENTS + constraint migration, or the send
silently no-ops):

- `lib/email/templates.ts`: add `"complete_registration"` to `CommsKind` and
  `complete_registration__guest` to `TemplateKey` + `TEMPLATE_REGISTRY`, with a
  `{{completionLink}}` placeholder; add `completionLink` to `PLACEHOLDERS` and
  `buildVars` (which mints the token for the booking).
- `lib/email/comms.ts`: `RECIPIENTS.complete_registration = ["guest"]`.
- Migration `supabase/migrations/00NN_email_log_complete_registration.sql`
  (numbered past the **remote** max via `list_migrations`, applied with
  `apply_migration`): drop + re-add `email_log_event_kind_check` including
  `'complete_registration'`.

## Data flow

```
Luma invite → guest.registered webhook → ingestRegistration (live)
  └─ upsert booking (all form fields null, status=no_help_needed)
  └─ isInvitedGuest && approved → sendBookingComms("complete_registration")
         └─ email with /complete-registration/{token}

Guest clicks link → load API (verify token) → renders event's Luma questions
Guest submits → submit API (verify token)
  └─ reconstruct registration_answers → normalizeGuest → ingestRegistration(live:false)
       └─ match slot, status no_help_needed→unassigned, push to both Notion workspaces
  └─ on-page success (no Slack, no confirmation email)
```

## Components (each independently testable)

- `isInvitedGuest(norm)` — pure predicate (lib/events or lib/luma/parse).
- `lib/auth/booking-token.ts` — issue/verify, pure given a clock.
- Load/submit API routes — thin HTTP wrappers over the above + existing ingest.
- Comms kind wiring — template + recipients + migration.

## Testing (TDD)

- `isInvitedGuest`: true for an empty-answer guest; false when any field is set.
- `booking-token`: round-trips; rejects tampered, malformed, and >14-day-old tokens.
- Answer reconstruction: form inputs → `registration_answers` → `normalizeGuest`
  yields the expected fields + matched slot (incl. a translated/option form).
- Webhook auto-send: an approved invited guest triggers one `complete_registration`
  send; a form-filler or a pending/waitlist guest triggers none; a second webhook
  does not resend.
- Template render: `complete_registration__guest` includes the completion link.

## Risks / edge cases

- **VIPs/speakers** are also added via "invite" and will receive the email. Accepted
  for v1; a future `events`/booking suppress flag can gate it.
- **Token expired** (>14 days): friendly "this link expired — contact us" screen; a
  resend path is a future add.
- **Event not on a connected calendar / no Luma questions**: the load API returns a
  clear error; no partial form.
- **Guest partially known** (invited but hub later learned some fields): form
  prefills from the booking; resubmission is idempotent via `luma_guest_id`.

## Reused machinery (file references)

- `app/change-slot/*` — closest existing guest-form model.
- `lib/luma/parse.ts` `normalizeGuest` + `lib/events/ingest.ts` `ingestRegistration`
  — the write-back pipeline.
- `lib/luma/client.ts` `getLumaEvent`, `extractSlotOptions`; `lib/db/slots.ts`
  `matchSlotForEvent`.
- `lib/auth/token.ts` (HMAC) for `booking-token.ts`.
- `lib/email/comms.ts` + `lib/email/templates.ts` for the new comms kind.
