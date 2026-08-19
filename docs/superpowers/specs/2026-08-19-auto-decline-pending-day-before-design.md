# Auto-Decline Still-Pending Guests the Day Before an Event — Design

**Date:** 2026-08-19
**Status:** Draft (awaiting user review)

## Goal

Once a day, for every event happening *tomorrow*, decline every booking still at
`luma_status = 'pending'`. Declining a booking (via the existing `applyLumaStatus`
orchestrator) sends the guest our `declined` email, writes `declined` back to Luma
(with `send_email: false`, so Luma sends no email of its own — no duplicate), and
mirrors `Declined` to both Notion workspaces.

Rule: **all pendings**, regardless of whether they requested a 1:1 or are
spectators. If we never approved you by the day before, you're declined.

## Non-goals

- No change to `approved` / `waitlist` / already-`declined` bookings — only
  `pending` is swept.
- No new email template — reuses the existing `declined` comms kind.
- No new Luma writeback plumbing — reuses `updateGuestStatus`, which already
  suppresses Luma's own email for non-approval statuses.
- No safety cap on how many are declined per run (per decision).

## Why reuse `applyLumaStatus`

`lib/sync/approval.ts`'s `applyLumaStatus(booking, next, opts, deps)` already
performs exactly one correct decline: persist `luma_status`, send the `declined`
comm, write the decision back to Luma (for any `opts.source !== "luma"`), and push
the resulting state to both Notion cards. The cron simply calls it once per
pending booking. This keeps the decline logic in one place.

The only change the orchestrator needs is a new **source** value so the Luma
writeback fires for cron-originated declines.

## Timing

New standalone cron at **13:00 UTC**, ahead of the other day-before crons:
`agenda` (14:00), `prep-reminder` (16:00), `rematch-apology` (17:00). Running
first means declined guests are already `declined` before those crons run, so they
are naturally excluded from the prep / agenda / rematch-apology sends (a pending
1:1-requester won't receive both a decline and a "we couldn't match you" apology).

## Components

### 1. `lib/sync/approval.ts`
Add `"cron"` to the `ApprovalSource` union:

```ts
export type ApprovalSource = "luma" | "dev" | "ambassador" | "cron";
```

The existing writeback guard (`if (opts.source !== "luma")`) then covers cron
automatically — no other change.

### 2. `lib/db/bookings.ts`
Add `listPendingBookingsForEvent(eventId)` → bookings for the event with
`luma_status = 'pending'`.

### 3. `lib/events/decline-pending.ts` (new)
Following the `lib/events/rematch.ts` pattern:

- **`selectDeclinablePendings(bookings)`** — pure, unit-testable; filters to
  `luma_status === "pending"`.
- **`dispatchDeclinePendingForTomorrow(now = new Date())`** —
  `listEventsByDate(tomorrow)` → for each event, load pendings via the db helper →
  `applyLumaStatus(b, "declined", { source: "cron" }, deps)` per booking. Returns
  `{ events, guests }`. Best-effort: a per-booking failure is logged and does not
  abort the rest of the sweep.
- Builds the same `ApplyDeps` shape the Notion webhook route builds
  (`setLumaStatus`, `resetAssignment`, `pushToWorkspaces`, `updateGuestOnLuma`,
  `sendComms`, `getEventLumaId`, `log`).

### 4. `app/api/cron/decline-pending/route.ts` (new)
Cron-secret auth identical to the other crons (`x-cron-secret` header or
`Authorization: Bearer`), calls `dispatchDeclinePendingForTomorrow()`, and
`logSync`s a summary. `runtime = "nodejs"`, `maxDuration = 60`. Accepts GET and
POST (Vercel Cron issues GET).

### 5. `vercel.json`
Add:

```json
{ "path": "/api/cron/decline-pending", "schedule": "0 13 * * *" }
```

## Idempotency & safety

- **Naturally idempotent** — once a booking flips to `declined` it no longer
  matches the `pending` filter, so re-runs skip it. The `declined` email is also
  deduped by `email_log` on (booking, kind).
- **No assigned pendings** — a claim auto-promotes `pending → approved`, so a
  pending is never `assigned`; the downgrade's helper/slot-release branch in
  `applyLumaStatus` is a safe no-op here.
- **No cap** — declines every pending for tomorrow's events, however many.

## Testing

- `selectDeclinablePendings`: selects only `pending`; ignores
  `approved` / `waitlist` / `declined`.
- `dispatchDeclinePendingForTomorrow`: targets tomorrow's events only; calls
  `applyLumaStatus` with `"declined"` once per pending; sums `{ events, guests }`;
  a per-booking failure does not abort the remaining declines.
- Source wiring: `source: "cron"` triggers the Luma writeback (covered by the
  existing `applyLumaStatus` deps behavior — `source !== "luma"`).

## Rollout

1. Deploy code (adds the route + cron).
2. `vercel.json` cron registers on deploy; first run at the next 13:00 UTC.
3. Confirm via `sync_log` after the first run: one `decline_pending_cron` summary
   plus per-booking `luma_status:declined` entries.

## Open risks

- **Timezone of "tomorrow"** — `listEventsByDate` matching mirrors the existing
  rematch/prep crons; the 13:00 UTC fire time must land on the intended calendar
  day for all event cities. Reuse the same date-window helper the other day-before
  crons use so behavior is consistent.
