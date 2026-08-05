# Full Intake Capture + Notion-Driven Approval Sync — Design

**Date:** 2026-08-05
**Status:** Draft (awaiting user review)

## Goal

Three changes to the Build Bar booking hub:

1. **Capture all intake fields** from the finalized Luma registration form
   (Notion email, Notion plan, experience level, reasons for attending, plus the
   existing company/role/challenge/slot).
2. **Remove the approval gate** so *every* Luma registrant lands in Supabase and
   both Notion databases — not just pre-approved guests.
3. **Notion-driven approval**: organizers set a **"Luma Status"** (Pending /
   Approved / Waitlist / Declined) in *either* Notion database; the hub writes it
   to Supabase, pushes it back to Luma via the Luma API, and mirrors it to the
   other Notion database.

## Non-goals

- No change to the helper claim/unclaim flow, check-in flow, or no-show cron.
- No change to the per-event slot capacity model (still capacity 1 per slot).
- No Notion↔Luma direct wiring. The Supabase hub remains the sole broker
  (hub-and-spoke); Notion and Luma are spokes that only talk to the hub.

## Two independent status axes

The existing `status` (assignment) and the new `luma_status` (approval/triage)
are **separate** columns so they never clobber each other.

| Axis | Supabase | Notion property | Values |
|---|---|---|---|
| Approval | `luma_status` (new enum) | **Luma Status** (select) | `pending` / `approved` / `waitlist` / `declined` |
| Assignment | `status` (existing enum, +1) | **Status** (select) | `no_help_needed` (new) / `unassigned` / `assigned` / `checked_in` / `no_show` / `cancelled` |

Notion "Luma Status" already exists in **Dev** (Pending·blue, Approved·green,
Waitlist·yellow, Declined·red) and "No help needed"·red already exists in Dev's
Status. Ambassador has neither yet.

## Data model (Supabase migration `0009`)

```sql
create type luma_status as enum ('pending','approved','waitlist','declined');
alter type booking_status add value if not exists 'no_help_needed';

alter table bookings
  add column luma_status      luma_status not null default 'pending',
  add column notion_email     text,
  add column notion_plan      text,
  add column experience_level text,
  add column attend_reasons   text,          -- multi-select, comma-joined
  add column requested_slot   text;          -- text preference; NOT a slot_id reservation

create index bookings_luma_status_idx on bookings (luma_status);

-- Recreate booking_details so its `select b.*` picks up the new columns.
-- Body is byte-identical to migration 0001's definition (b.* + event/slot joins);
-- the new bookings columns flow through automatically via b.*.
drop view booking_details;
create view booking_details as
  select b.*, e.city as location, e.name as event_name, e.event_date, e.timezone,
         s.name as slot_name, s.starts_at as slot_starts_at, s.ends_at as slot_ends_at
  from bookings b
  join events e on e.id = b.event_id
  left join slots s on s.id = b.slot_id;
```

Notes:
- `alter type ... add value` cannot run inside a transaction on older Postgres
  and the new value isn't usable until committed; keep it in its own migration
  step ahead of any statement that references `'no_help_needed'`.
- `requested_slot` is deliberately decoupled from `slot_id`. `slot_id` (the real
  capacity-1 reservation) is still bound only on claim — never at registration —
  so many Pending guests can request the same time without colliding.

## Intake mapping (`lib/luma/parse.ts`)

The current matcher guesses by `question_type`, which breaks now that plan,
experience, and slot are all single-selects. Replace the heuristic with
**label-pinned** matching (the form is finalized), keeping `question_id` as the
preferred key when present:

| Answer (label contains, case-insensitive) | Field |
|---|---|
| company type (`{company, job_title}`) | `company`, `role` |
| "email…Notion" | `notion_email` |
| "Notion plan" | `notion_plan` |
| "experience level" | `experience_level` |
| "why…come" / "Build Bar" | `attend_reasons` (multi-select → comma-joined) |
| "help…building" / long-text | `challenge` |
| "requested time slot" / dropdown | `requested_slot` |

`NormalizedRegistration` gains: `notionEmail`, `notionPlan`, `experienceLevel`,
`attendReasons`, and renames `requestedSlotLabel` usage toward `requestedSlot`.

## Luma approval_status → luma_status

```
approved                         -> approved
declined                         -> declined
waitlist                         -> waitlist
pending_approval | pending | invited | (anything else / null) -> pending
```

`lib/events/lifecycle.ts` (the create/ignore/cancel gate) is **removed**;
replaced by this pure mapping helper.

## Flow: Luma → hub (`app/api/webhooks/luma/route.ts`)

1. Verify signature, parse, filter to `guest.registered` / `guest.updated` (unchanged).
2. `normalizeGuest` (now returns all new fields).
3. Resolve event by `luma_event_id`; if unknown, log + ignore (unchanged).
4. **Upsert unconditionally** (gate removed). On **create**, set:
   - `luma_status` = mapped from `approval_status`.
   - `status` = `unassigned` if `requested_slot` present, else `no_help_needed`.
   On **update**, refresh guest fields + `luma_status`; do **not** clobber an
   assignment `status` that has advanced past the initial value (respect claims).
5. Persist all new intake fields.
6. Check-in transition (unchanged): flip to `checked_in`, send comms.
7. Push to both Notion (`fullUpdate: true`) including Luma Status + new fields.

A Luma-side approval change (guest declines, host approves in Luma) arrives as
`guest.updated` and flows through the shared `applyLumaStatus` path below.

## Flow: Notion → hub (`app/api/webhooks/notion/[workspace]/route.ts`)

Add a **Luma Status change** branch alongside the existing claim/release logic.
Detection is **property-diff** (no new buttons): the organizer configures a Notion
automation *"When Luma Status changes → Send webhook"* per workspace.

1. Fetch page, compute incoming synced fields (now incl. `luma_status`).
2. Loop-prevention: if incoming hashes to `last_synced_hash`, drop as echo.
3. If `incoming.luma_status !== booking.luma_status` → `applyLumaStatus(booking,
   incoming.luma_status, { source: workspace })`.
4. Else fall through to existing claim/release handling, with two additions:
   - **Claim auto-approval** — when a claim advances `unassigned → assigned` and
     the booking's `luma_status` is `pending`, promote it to `approved` in the
     same transaction (folded into the claim's single push so one write carries
     both `Status = Assigned` and `Luma Status = Approved`, plus one Luma
     writeback via `applyLumaStatus(..., { source: workspace })`). Only `pending`
     is promoted; `waitlist`/`declined` are deliberate states and are left
     untouched (an organizer re-approves explicitly). A claim implicitly triages
     an untriaged guest, and — because approval writes back to Luma — the guest
     gets their Luma confirmation the moment a helper picks them up.
   - **Unclaim/release email** — when a booking goes `assigned → unassigned`
     (either the Unclaim button / `x-action: unclaim`, or an assignee cleared
     manually), send the guest a **"expert unavailable"** email: *"Your Notion
     expert is unavailable; we'll find a replacement for you soon."* `luma_status`
     stays `approved` (the guest is still in); only the helper assignment is
     cleared. Helper is not emailed (they initiated the release).

### `applyLumaStatus(booking, next, opts)` (shared by both inbound legs)

1. Update `luma_status` in Supabase.
2. **Downgrade effect** — if `next ∈ {waitlist, declined}` and the booking was
   `assigned`: release the helper, free `slot_id`, set assignment `status` →
   `no_help_needed` (if no requested slot) or `unassigned` (if one was requested),
   and send the **cancellation emails** (guest + helper, see Comms).
3. **Luma writeback** — only when `opts.source` is a Notion workspace (not when
   the change originated from Luma): call
   `POST https://public-api.luma.com/v1/event/update-guest-status`
   with the guest id + event id + target status
   (`approved`/`declined`/`waitlist`/`pending`). Log failures to `sync_log`;
   a failure does not roll back the hub state (Luma reconciles on next webhook).
4. Push the resulting state to **both** Notion workspaces; `stampSynced` so the
   echo is dropped.

## Loop prevention (`lib/sync/types.ts`, `lib/sync/hash.ts`)

`SyncedFields` gains `luma_status`. The hash now covers
`{ status, luma_status, booked_by_display_name, booked_by_type }` so a Luma Status
edit in Notion is (a) detected as a real change and (b) recognized as an echo
after the hub re-pushes it.

## Notion schema (`lib/notion/schema.ts`, `lib/notion/mappers.ts`)

New `PROP` entries + labels:
- `PROP.lumaStatus = "Luma Status"` with `LUMA_STATUS_LABEL` {pending:"Pending",
  approved:"Approved", waitlist:"Waitlist", declined:"Declined"} (colors: blue,
  green, yellow, red — matching Dev).
- `STATUS_LABEL.no_help_needed = "No help needed"` (red).
- `PROP.notionEmail`, `PROP.notionPlan`, `PROP.experienceLevel`, `PROP.reasons`,
  `PROP.requestedSlot`.

Field types in Notion (per decision): **selects** for Notion plan
(Enterprise/Business/Plus/Free), experience level (4 levels), and reasons
(multi-select: 1:1 help / cowork / just checking); **text** for Notion email and
requested slot. Exact option labels are seeded from the Luma form; Notion also
auto-creates any missing select option on write as a safety net.

Mappers:
- `bookingToPageProperties` writes Luma Status + all new fields to **both**
  workspaces (Dev and Ambassador both get the intake fields).
- `pagePropertiesToSyncedFields` reads back Luma Status (→ `luma_status`).
- `statusToLabel`/`labelToStatus` handle `no_help_needed`; add
  `lumaStatusToLabel`/`labelToLumaStatus`.

## Notion schema rebuild script

An **idempotent** script (extends `scripts/create-notion-databases.ts` style,
using `dataSources.update`) that, per workspace:
- ensures **Luma Status** exists with the four options (create in Ambassador);
- ensures **Status** contains **No help needed** (add in Ambassador);
- ensures the new intake properties exist in **both** DBs.

Run once against Dev (no-ops the existing props) and Ambassador (creates the
missing ones). Existing rows/pages are untouched; new props are simply added.

## Comms (`lib/email/templates.ts`, `lib/email/comms.ts`)

Two new comms kinds:

1. **Cancellation** (waitlist/declined after a claim) — emails **both** guest and
   helper:
   - guest: "your Notion Build Bar 1:1 booking was cancelled";
   - helper: "the booking you claimed has been released".

2. **Expert-unavailable** (unclaim/release of an assigned booking) — emails the
   **guest only**:
   - guest: "Your Notion expert is unavailable; we'll find a replacement for you
     soon." The guest remains `approved` and returns to the open queue
     (`unassigned`) for a new helper to claim.

These are distinct: cancellation removes the guest from the 1:1 (approval
downgraded); expert-unavailable keeps them in and reassures them a replacement is
coming.

Caveat to surface in rollout: pushing `declined` to Luma may also trigger Luma's
own guest email — a possible duplicate to the guest on cancellation. Acceptable
for now; revisit if noisy.

## Testing

- `parse.ts`: unit tests for label-pinned mapping of all 7 questions, incl.
  multi-select join and empty requested-slot → (drives `no_help_needed`).
- `lifecycle`/mapping: `approval_status` → `luma_status` table.
- Luma webhook: gate removed — pending/waitlist/declined guests now create rows;
  initial `status` chosen by presence of `requested_slot`.
- Notion webhook: Luma Status diff triggers `applyLumaStatus`; echo dropped;
  claim/release still works.
- Claim auto-approval: `unassigned → assigned` promotes `pending → approved`
  (with Luma writeback) but leaves `waitlist`/`declined` untouched.
- Unclaim/release: `assigned → unassigned` sends the guest the expert-unavailable
  email, keeps `luma_status = approved`, and does not email the helper.
- `applyLumaStatus`: downgrade releases helper+slot and sends both cancellation
  emails; Luma writeback called only for Notion-origin changes, not Luma-origin.
- mappers: round-trip Luma Status + `no_help_needed`; hash includes `luma_status`.
- comms templates: cancellation subject/body for guest and helper.

## Rollout

1. Apply migration `0009`.
2. Run the Notion schema rebuild script (Dev + Ambassador).
3. Deploy code.
4. In Notion (both workspaces): add the automation *"When Luma Status changes →
   Send webhook"* pointing at `/api/webhooks/notion/{dev|ambassador}` with the
   shared secret header.
5. Confirm the Luma event's approval mode matches intent (guests can register so
   the hub sees them; approval performed via Notion → Luma writeback).

## Open risks

- **Luma `update-guest-status` request shape** is confirmed to exist but its
  exact body/enum spelling (`waitlist` vs `waitlisted`, event id param name) must
  be pinned during implementation against the live endpoint.
- **Duplicate guest email** on decline (Luma + hub) as noted above.
- **Notion auto-created select options** could drift from seeded labels if the
  Luma form wording changes; the rebuild script is the source of truth for seeds.
