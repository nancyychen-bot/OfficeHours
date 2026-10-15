# Invited-Guest Status + Auto-Sync — Design

**Date:** 2026-10-14
**Branch:** `feat/invited-guest-completion` (repurposed)
**Supersedes:** the invited-guest *completion-form* feature (spec `2026-10-13-invited-guest-completion-form-design.md`), which is being removed — see §7.

## Problem

Hosts invite guests to a Luma event directly. Those guests show up in Luma's
`guests/list` with `approval_status: "invited"` (distinct from `approved` /
`pending_approval` / `waitlist` / `declined`), `joined_at: null`, and **zero
registration answers**. They are NOT a registration yet — accepting the invite
presents the full Build Bar form, and only submitting it registers them.

Two consequences in the current hub:

1. **Invited guests never enter the hub.** No registration webhook fires for an
   un-accepted invite, and the `luma-stats` cron only *counts* guests. So
   invited guests (233 on Singapore alone) are invisible in the hub and Notion.
2. **Latent bug:** `approvalStatusToLumaStatus("invited")` falls through to
   `pending`. If an invited guest were ever ingested, the day-before
   auto-decline sweep (which targets `pending`) would wrongly decline them.

Note: the earlier *completion-form email* feature was built on the assumption
that invited guests arrive `approved` with no answers and can be emailed a form
link. The accept-flow screenshot disproves that premise (accepting already shows
the form), so that feature is redundant and is removed here.

## Goal

Represent invited guests in the hub as a first-class `invited` status, synced
automatically from Luma and mirrored to both Notion workspaces, kept out of the
active 1:1 pipeline until they accept — at which point the normal registration
webhook transitions them with their real answers.

## Design

### 1. New `luma_status` value: `invited`

- Migration: `ALTER TYPE luma_status ADD VALUE IF NOT EXISTS 'invited';`
  (numbered past the remote max; applied via Supabase `apply_migration`).
  `ADD VALUE` cannot run inside a txn with its use, so the migration only adds
  the value; code using it ships separately.
- `approvalStatusToLumaStatus("invited")` → `"invited"` (new case; everything
  still-unknown stays `pending`).
- Regenerate `lib/supabase/types.ts` so `LumaStatus` includes `"invited"`.

### 2. Ingestion on the existing `luma-stats` cron

The `luma-stats` cron (every 15 min, stalest-first, capped at
`LUMA_STATS_MAX_PER_RUN = 20` events) already fetches each event's full
`guests/list` to compute counts, then discards the entries.

- Refactor so the guest list is fetched **once per event** and used for BOTH
  `fetchEventStats` (counts) AND invited-guest ingestion — no extra Luma calls,
  preserving the rate-limit discipline that the per-run cap exists for.
- For each entry with `approval_status === "invited"`: upsert a booking with
  `luma_status = 'invited'` via the existing `normalizeGuest → ingestRegistration({ live: false })`
  path (silent — no emails; already mirrors to both Notion DBs).
- **Change-guard:** skip an invited entry when the stored booking already
  reflects it (same `luma_status` + identity), so unchanged invited guests are
  NOT re-upserted/re-pushed to Notion every tick. Only new or changed invites do
  work. (Outbound Notion pushes are not otherwise deduped — this guard is what
  bounds the cost of 200+ invited guests.)
- The manual `register:event` backfill already ingests every guest; it picks up
  the new status automatically (no change needed beyond the mapping).

### 3. Notion mirror (both workspaces)

- `ingestRegistration` already calls `pushBookingToWorkspaces`, so invited
  bookings mirror to Dev + Ambassador automatically.
- Add an `Invited` option to the status (luma_status) select on both DBs and to
  the mapper (`labelToLumaStatus` / status→label) in `lib/notion/mappers.ts`.
- **Manual (operator) step:** filter `Invited` out of the active pipeline views
  in both Notion DBs, same as other non-active statuses.

### 4. Pipeline protection (emergent from the status)

No new gates needed — the distinct status does the work:
- Decline sweep targets `pending` → invited excluded (fixes the latent bug).
- Prep reminders, rematch, cowork-notice, matching target `approved` → excluded.
- Readiness "approved" counts unaffected.

Audit (part of implementation): grep every `luma_status` consumer and confirm
none treat `invited` as actionable; add explicit exclusions only where a
consumer keys on "not declined" rather than a specific status.

### 5. Transition on accept

When an invited guest clicks Accept and submits the form, Luma fires the normal
`guest.registered` webhook. `approval_status` is now `approved`/`pending` WITH
answers → `ingestRegistration` upserts the same row (keyed on `luma_guest_id`),
`decideBookingStatusPatch` transitions `invited → approved/pending`, answers and
slot populate, and both Notion mirrors update. No special-case code.

### 6. Edge cases

- **Declined/removed invite:** if a guest's `approval_status` later leaves
  `invited` (e.g. `declined`), the next sync upserts the new status (normal).
- **Invited guest who registers directly (not via our sync):** webhook path
  already handles it; keyed on `luma_guest_id` so no duplicate.
- **Volume:** 200+ invited/event × many events. The per-run event cap + the
  change-guard bound Notion/Luma call volume. Log a one-line summary per cron
  run (invited ingested / skipped) so silent truncation is visible.

### 7. Removal of the completion-form feature

Delete (this branch introduced them):
- `app/complete-registration/[token]/` (page + form) and
  `app/api/complete-registration/{load,submit}/`.
- `lib/auth/booking-token.ts` + `tests/booking-token.test.ts` (only consumer was
  the completion link).
- `shouldSendCompletion` + the ingest auto-send wiring in `lib/events/ingest.ts`.
  Keep `isInvitedGuest` only if a consumer remains; otherwise remove it.
- `complete_registration` comms kind + template + `RECIPIENTS` entry +
  `completionLink` in `CommsFields`/`buildVars` + the link minting in
  `comms.ts` `getFields`.
- The `/complete-registration` entry in `middleware.ts` allowlist.
- Scripts `test-completion-flow.ts` / `test-completion-teardown.ts`.
  Keep `scripts/preview-comms.ts` (generally useful).

Leave in place (harmless / not worth reverting):
- Migration `0059` (adds `complete_registration` to the `email_log` CHECK
  constraint) is already applied to prod. An unused enum-ish kind is harmless;
  removing it would need another migration. Note it as dormant.

### 8. Testing

- Unit: `approvalStatusToLumaStatus("invited") === "invited"`; the change-guard
  (skip unchanged, ingest new/changed); the cron batch selection unchanged.
- Unit: a `pending`-only decline-sweep selector still excludes `invited`.
- Regenerated types compile; `tsc` + full vitest green.
- Live verification (throwaway-safe): run the `luma-stats` sync for Singapore,
  confirm Nancy (`invited`) is ingested as `luma_status='invited'`, mirrored to
  both Notion DBs, and NOT selected by the decline sweep; then confirm a second
  run skips her (change-guard). Confirm accept→form transitions her to
  approved with answers.

## Non-goals

- No email to invited guests (accepting already presents the form).
- No new cron (reuse `luma-stats`).
- No Notion view automation (operator filters `Invited` manually).
