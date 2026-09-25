# Cowork-only acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an organizer accept an unclaimed 1:1 registrant for coworking with one Notion button — flipping them to a new `cowork_only` status, approving them in Luma, and sending exactly one acceptance email, all idempotently.

**Architecture:** A new `cowork_only` value on the `booking_status` enum (sibling of `no_help_needed`). A new `x-action: "cowork_only"` branch on the existing Notion→hub webhook (`/api/webhooks/notion/[workspace]`, Dev-only button) resolves the booking and calls a new atomic `acceptCoworkOnly()` DB writer. Setting `luma_status='approved'` removes them from the pending-only cutoff cron; `status='cowork_only'` (not `unassigned`) blocks the 1:1 claim path. The email reuses the existing template + `email_log` idempotency infrastructure.

**Tech Stack:** Next.js (App Router, `nodejs` runtime), Supabase (Postgres + admin client), Notion API, Luma API, Resend, Vitest.

---

## Background — verified facts (read before starting)

- `bookings.status` enum today: `unassigned | assigned | checked_in | no_show | cancelled | no_help_needed` (`lib/supabase/types.ts` ~line 651 union, ~line 794 `Constants` array).
- `bookings.luma_status` enum: `pending | approved | waitlist | declined`.
- `claimBooking` (`lib/db/bookings.ts:242`) succeeds only on `status='unassigned'` + `filtered=false` via a conditional UPDATE. So a `cowork_only` booking can never be claimed.
- Cutoff auto-decline (`lib/events/decline-pending.ts:17`) selects declinable guests by `luma_status === 'pending'` only. Setting `luma_status='approved'` excludes a cowork-accepted registrant automatically.
- `decideBookingStatusPatch` (`lib/db/bookings.ts:131`) already returns `{}` (no change) for an active, non-declined booking whose `existingStatus` is anything other than `null`/`cancelled`/(waitlisted-and-assigned). So `cowork_only` is **already sticky** against inbound Luma `approved`/`pending` webhooks — Task 6 only adds a regression test, no code change.
- Notion→hub webhook (`app/api/webhooks/notion/[workspace]/route.ts`): verifies `x-webhook-secret`, resolves the booking by page id (`getBookingByNotionPageId`), dispatches by the `x-action` header. It already imports `getEventById`, `updateGuestStatus`, `apiKeyForCalendar`, `pushBookingToWorkspaces`, `sendBookingComms`, `logSync`, `getBookingById`.
- Email: `templateKeyFor(kind, role, f)` (`lib/email/templates.ts:669`) returns `` `${kind}__${role}` `` when that key exists in `TEMPLATE_REGISTRY`. `RECIPIENTS` (`lib/email/comms.ts:94`) is `Record<CommsKind, Recipient[]>` — adding a `CommsKind` forces a `RECIPIENTS` entry (TS error otherwise). Idempotency is via `reserveCommsSlot` / the `email_log` unique key `(booking_id, event_kind, recipient_email)`.
- Notion status labels: `STATUS_LABEL` (`lib/notion/schema.ts:43`) maps enum→label; `mappers.ts` derives both directions from it. `statusToLabel` does NOT enforce completeness at compile time, so a missing label silently clears the Notion Status — Task 2's round-trip test guards this.
- Tests: Vitest, in `tests/`. Run all with `npm test`. Run one file/case with `npx vitest run tests/<file>.test.ts -t "<name>"`. Pure functions are tested directly; DB writers are not unit-tested (only their pure decision helpers are).
- Repo is in iCloud Drive — commit with explicit `git add <paths>`, never `git add -A` (avoids `"<name> 2.ext"` duplicates).

---

## File structure

- `supabase/migrations/<NNNN>_booking_status_cowork_only.sql` — **create**: add the enum value.
- `lib/supabase/types.ts` — **modify**: add `"cowork_only"` to the `booking_status` union + `Constants` array.
- `lib/notion/schema.ts` — **modify**: `STATUS_LABEL.cowork_only` + a Status select option.
- `lib/email/templates.ts` — **modify**: `CommsKind` + `TemplateKey` unions + `TEMPLATE_REGISTRY` entry.
- `lib/email/comms.ts` — **modify**: `RECIPIENTS` entry.
- `lib/db/bookings.ts` — **modify**: `CoworkAcceptResult` type, `classifyCoworkAcceptMiss()` (pure), `acceptCoworkOnly()`.
- `lib/events/decline-pending.ts` — **modify**: exclude `cowork_only` from `selectDeclinablePendings`.
- `app/api/webhooks/notion/[workspace]/route.ts` — **modify**: import + `x-action: "cowork_only"` branch.
- Tests: `tests/notion-mappers.test.ts` (extend), `tests/cowork-accept-template.test.ts` (create), `tests/cowork-accept.test.ts` (create), `tests/decline-pending.test.ts` (extend), `tests/bookings-status.test.ts` (extend).

---

### Task 1: Add the `cowork_only` enum value

**Files:**
- Create: `supabase/migrations/<NNNN>_booking_status_cowork_only.sql`
- Modify: `lib/supabase/types.ts` (union ~line 651, `Constants` array ~line 794)

- [ ] **Step 1: Find the next migration number**

Call the Supabase MCP tool `list_migrations` and note the highest `version`. The new file's `<NNNN>` prefix must be greater than the highest **local** file number in `supabase/migrations/` AND consistent with the remote max (per the repo's migration-numbering rule). Example: if the highest local file is `0046_...` use `0047`.

- [ ] **Step 2: Create the migration file**

Create `supabase/migrations/<NNNN>_booking_status_cowork_only.sql`:

```sql
-- Add the "Cowork only" assignment status: an organizer accepts an unclaimed
-- 1:1 registrant for coworking when no volunteer claimed them (no 1:1 match).
-- Behaves as a sibling of no_help_needed ("attending, no 1:1"), but is a distinct,
-- separately-reportable state and drives the cowork-only acceptance email.
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'cowork_only';
```

- [ ] **Step 3: Apply the migration to the remote project**

Call the Supabase MCP tool `apply_migration` with `name: "booking_status_cowork_only"` and the SQL above. (Adding — not using — the value is safe even if wrapped in a transaction.)

- [ ] **Step 4: Update the generated types**

In `lib/supabase/types.ts`, add `"cowork_only"` to the `booking_status` union (after `"no_help_needed"`, ~line 657):

```ts
      booking_status:
        | "unassigned"
        | "assigned"
        | "checked_in"
        | "no_show"
        | "cancelled"
        | "no_help_needed"
        | "cowork_only"
```

And to the `Constants.public.Enums.booking_status` array (~line 794):

```ts
      booking_status: [
        "unassigned",
        "assigned",
        "checked_in",
        "no_show",
        "cancelled",
        "no_help_needed",
        "cowork_only",
      ],
```

(Running `npm run gen:types` later reproduces exactly this from the remote schema.)

- [ ] **Step 5: Verify typecheck passes**

Run: `npm run typecheck`
Expected: no errors (the new union member is unused so far).

- [ ] **Step 6: Commit**

```bash
git add "supabase/migrations/<NNNN>_booking_status_cowork_only.sql" lib/supabase/types.ts
git commit -m "feat(bookings): add cowork_only status enum value"
```

---

### Task 2: Notion "Cowork only" status label + round-trip mapping

**Files:**
- Modify: `lib/notion/schema.ts:43` (`STATUS_LABEL`) and `:82` (Status select options)
- Test: `tests/notion-mappers.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/notion-mappers.test.ts` (import `statusToLabel, labelToStatus` from `../lib/notion/mappers` — add them to the existing import if not present):

```ts
describe("cowork_only status mapping", () => {
  it("maps cowork_only <-> \"Cowork only\" both directions", () => {
    expect(statusToLabel("cowork_only")).toBe("Cowork only");
    expect(labelToStatus("Cowork only")).toBe("cowork_only");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/notion-mappers.test.ts -t "cowork_only status mapping"`
Expected: FAIL — `statusToLabel("cowork_only")` returns `undefined`.

- [ ] **Step 3: Add the label**

In `lib/notion/schema.ts`, add to `STATUS_LABEL` (after `no_help_needed`):

```ts
export const STATUS_LABEL = {
  no_help_needed: "No help needed",
  cowork_only: "Cowork only",
  unassigned: "Unassigned",
  assigned: "Assigned",
  checked_in: "Checked In",
  no_show: "No-show",
  cancelled: "Cancelled",
} as const;
```

And add a select option in `buildBookingsProperties` (in the `[PROP.status].select.options` array, after the `no_help_needed` option):

```ts
          { name: STATUS_LABEL.no_help_needed, color: "red" },
          { name: STATUS_LABEL.cowork_only, color: "yellow" },
          { name: STATUS_LABEL.unassigned, color: "gray" },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/notion-mappers.test.ts -t "cowork_only status mapping"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/notion/schema.ts tests/notion-mappers.test.ts
git commit -m "feat(notion): add Cowork only status label + mapping"
```

---

### Task 3: Cowork-only acceptance email template

**Files:**
- Modify: `lib/email/templates.ts` (`CommsKind` line 1, `TemplateKey` ~line 183, `TEMPLATE_REGISTRY` — add after the existing `cowork_only__guest` entry ~line 263)
- Modify: `lib/email/comms.ts:94` (`RECIPIENTS`)
- Test: `tests/cowork-accept-template.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/cowork-accept-template.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { templateKeyFor, renderComms, SAMPLE_FIELDS } from "../lib/email/templates";

describe("cowork_only_accept__guest", () => {
  it("routes to the guest template", () => {
    expect(templateKeyFor("cowork_only_accept", "guest", SAMPLE_FIELDS)).toBe(
      "cowork_only_accept__guest",
    );
  });

  it("states we're at capacity for 1:1 and offers coworking with no guarantee", () => {
    const r = renderComms("cowork_only_accept", "guest", SAMPLE_FIELDS)!;
    expect(r.subject.toLowerCase()).toContain("cowork");
    expect(r.text.toLowerCase()).toContain("at capacity for 1:1");
    expect(r.text.toLowerCase()).toContain("cowork with us");
    expect(r.text).toMatch(/does not include a guaranteed 1:1/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cowork-accept-template.test.ts`
Expected: FAIL — `renderComms` returns `null` (`cowork_only_accept` is not a `CommsKind`, and there is a TS error). This confirms the wiring is missing.

- [ ] **Step 3: Add the CommsKind**

In `lib/email/templates.ts` line 1, add `"cowork_only_accept"` to the `CommsKind` union (e.g. right after `"cowork_only"`):

```ts
... | "cowork_only" | "cowork_only_accept" | "guest_cancelled" | "prep_reminder_day_before_paid";
```

- [ ] **Step 4: Add the TemplateKey**

In the `TemplateKey` union (~line 183), change the last line so `cowork_only_accept__guest` is included:

```ts
  | "cowork_only__guest"
  | "cowork_only_accept__guest";
```

- [ ] **Step 5: Add the template to the registry**

In `TEMPLATE_REGISTRY`, immediately after the `cowork_only__guest` entry (~line 263), add:

```ts
  cowork_only_accept__guest: {
    label: "Cowork-only acceptance",
    description: "organizer accepts an unclaimed 1:1 registrant for coworking (no 1:1 match)",
    role: "guest",
    subject: "You're in — cowork with us at the Notion Build Bar ✨",
    body: b(
      "Hi {{firstName}},", "",
      "Thanks for signing up for a 1:1 at the **Notion Build Bar** in {{location}} on {{eventDate}}.", "",
      "We're **at capacity for 1:1 sessions, but we'd love to have you cowork with us** — come build alongside Notion experts, ask questions, and meet the community.", "",
      "One heads-up so you know what to expect: coworking **does not include a guaranteed 1:1 session** with a Notion expert. If a slot opens up we'll do our best, but please plan to cowork.", "",
      "{{eventInstructions}}", "",
      "Can't make it? Please **[cancel your registration]({{eventUrl}})** so we can free up your spot.", "",
      "See you there,", SIGNOFF, "", `*${SUPPORT}*`,
    ),
  },
```

- [ ] **Step 6: Add the recipient list**

In `lib/email/comms.ts` `RECIPIENTS` (~line 113, next to `cowork_only`):

```ts
  cowork_only: ["guest"],
  cowork_only_accept: ["guest"],
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/cowork-accept-template.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors (the `RECIPIENTS` record is now exhaustive again).

- [ ] **Step 9: Commit**

```bash
git add lib/email/templates.ts lib/email/comms.ts tests/cowork-accept-template.test.ts
git commit -m "feat(email): add cowork-only acceptance template"
```

---

### Task 4: `acceptCoworkOnly` DB writer + pure classifier

**Files:**
- Modify: `lib/db/bookings.ts` (add after `claimBooking`, ~line 270)
- Test: `tests/cowork-accept.test.ts` (create)

- [ ] **Step 1: Write the failing test (pure classifier)**

Create `tests/cowork-accept.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyCoworkAcceptMiss } from "@/lib/db/bookings";
import type { Booking } from "@/lib/sync/types";

const bk = (over: Partial<Booking>): Booking =>
  ({ id: "b1", status: "unassigned", luma_status: "pending", filtered: false, ...over } as Booking);

describe("classifyCoworkAcceptMiss", () => {
  it("not_found when the booking is missing", () => {
    expect(classifyCoworkAcceptMiss(null)).toEqual({ status: "rejected", reason: "not_found" });
  });

  it("noop when already cowork_only (idempotent second click)", () => {
    const current = bk({ status: "cowork_only", luma_status: "approved" });
    expect(classifyCoworkAcceptMiss(current)).toEqual({ status: "noop", booking: current });
  });

  it("rejects a filtered candidate", () => {
    const current = bk({ filtered: true });
    expect(classifyCoworkAcceptMiss(current)).toEqual({ status: "rejected", reason: "filtered", current });
  });

  it("rejects an already-claimed (assigned) booking — unclaim first", () => {
    const current = bk({ status: "assigned" });
    expect(classifyCoworkAcceptMiss(current)).toEqual({ status: "rejected", reason: "assigned", current });
  });

  it("rejects a cancelled/declined booking as ineligible", () => {
    const current = bk({ status: "cancelled", luma_status: "declined" });
    expect(classifyCoworkAcceptMiss(current)).toEqual({ status: "rejected", reason: "ineligible", current });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cowork-accept.test.ts`
Expected: FAIL — `classifyCoworkAcceptMiss` is not exported.

- [ ] **Step 3: Implement the type, classifier, and writer**

In `lib/db/bookings.ts`, after `claimBooking` (line 270), add:

```ts
export type CoworkAcceptResult =
  | { status: "accepted"; booking: Booking }
  | { status: "noop"; booking: Booking } // already cowork_only
  | { status: "rejected"; reason: "not_found" }
  | { status: "rejected"; reason: "filtered" | "assigned" | "ineligible"; current: Booking };

/**
 * Pure: classify the outcome when the atomic accept-UPDATE matched no row.
 * `current` is the booking as it exists now. Order matters: an already-accepted
 * booking is an idempotent no-op; a filtered/assigned booking is a deliberate
 * refusal (the organizer must unfilter / unclaim first); anything else
 * (cancelled, declined, checked_in, no_show, no_help_needed) is ineligible.
 */
export function classifyCoworkAcceptMiss(current: Booking | null): CoworkAcceptResult {
  if (!current) return { status: "rejected", reason: "not_found" };
  if (current.status === "cowork_only") return { status: "noop", booking: current };
  if (current.filtered) return { status: "rejected", reason: "filtered", current };
  if (current.status === "assigned") return { status: "rejected", reason: "assigned", current };
  return { status: "rejected", reason: "ineligible", current };
}

/**
 * Accept an unclaimed 1:1 registrant for COWORKING ONLY (organizer action).
 * Atomic, first-wins conditional UPDATE guarded by `status = 'unassigned'` +
 * `filtered = false` — the same arbiter pattern as claimBooking, so a
 * simultaneous 1:1 claim and cowork-accept can never both win. On success the
 * booking becomes `cowork_only` (not claimable — claim requires 'unassigned')
 * and `luma_status = 'approved'` (excluded from the pending-only cutoff cron).
 * Idempotent: a second click matches no row and returns `noop`.
 */
export async function acceptCoworkOnly(bookingId: string): Promise<CoworkAcceptResult> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .update({ status: "cowork_only", luma_status: "approved" })
    .eq("id", bookingId)
    .eq("status", "unassigned") // <-- first-wins guard vs a racing 1:1 claim
    .eq("filtered", false) // filtered candidates are hidden + not acceptable
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (data) return { status: "accepted", booking: data };
  return classifyCoworkAcceptMiss(await getBookingById(bookingId));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/cowork-accept.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/db/bookings.ts tests/cowork-accept.test.ts
git commit -m "feat(bookings): add acceptCoworkOnly atomic writer + classifier"
```

---

### Task 5: Exclude `cowork_only` from the cutoff auto-decline

**Files:**
- Modify: `lib/events/decline-pending.ts:17`
- Test: `tests/decline-pending.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/decline-pending.test.ts`, add a case to the existing `describe("selectDeclinablePendings", ...)` block:

```ts
  it("never declines a cowork_only registrant, even if still pending", () => {
    const rows = [
      bk({ id: "p1", luma_status: "pending", status: "unassigned" }),
      bk({ id: "c1", luma_status: "pending", status: "cowork_only" }),
    ];
    expect(selectDeclinablePendings(rows).map((b) => b.id)).toEqual(["p1"]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/decline-pending.test.ts -t "never declines a cowork_only"`
Expected: FAIL — `c1` is included (currently selects all pendings).

- [ ] **Step 3: Add the exclusion**

In `lib/events/decline-pending.ts`, update `selectDeclinablePendings` (line 17) and its doc comment:

```ts
/**
 * All still-`pending` bookings are declinable the day before the event —
 * regardless of whether they requested a 1:1 (unassigned) or not (no_help_needed).
 * Approved / waitlist / already-declined are left untouched. `cowork_only`
 * registrants are never declined: an organizer deliberately accepted them for
 * coworking (belt-and-suspenders — accepting also sets luma_status='approved').
 */
export function selectDeclinablePendings(bookings: Booking[]): Booking[] {
  return bookings.filter((b) => b.luma_status === "pending" && b.status !== "cowork_only");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/decline-pending.test.ts`
Expected: PASS (all cases in the file, including the existing ones).

- [ ] **Step 5: Commit**

```bash
git add lib/events/decline-pending.ts tests/decline-pending.test.ts
git commit -m "feat(decline): exclude cowork_only from auto-decline"
```

---

### Task 6: Regression test — `cowork_only` is sticky against Luma webhooks

No code change (verified: `decideBookingStatusPatch` already returns `{}` for a non-null, non-cancelled, active status). This locks that behavior so a future edit can't silently revert a cowork-only registrant.

**Files:**
- Test: `tests/bookings-status.test.ts`

- [ ] **Step 1: Write the test**

In `tests/bookings-status.test.ts`, add inside the existing `describe("decideBookingStatusPatch", ...)`:

```ts
  it("keeps cowork_only sticky against inbound approved/pending webhooks", () => {
    expect(decideBookingStatusPatch("cowork_only", "approved", "2:00-2:30 PM")).toEqual({});
    expect(decideBookingStatusPatch("cowork_only", "pending", "2:00-2:30 PM")).toEqual({});
    expect(decideBookingStatusPatch("cowork_only", "waitlist", "2:00-2:30 PM")).toEqual({});
  });

  it("still cancels a cowork_only registrant who declines in Luma", () => {
    expect(decideBookingStatusPatch("cowork_only", "declined", "2:00-2:30 PM")).toEqual({
      status: "cancelled",
      slot_id: null,
      booked_by_display_name: null,
      booked_by_type: null,
      booked_by_email: null,
    });
  });
```

- [ ] **Step 2: Run the test to verify it passes immediately**

Run: `npx vitest run tests/bookings-status.test.ts`
Expected: PASS (behavior already correct — this is a characterization/regression test).

- [ ] **Step 3: Commit**

```bash
git add tests/bookings-status.test.ts
git commit -m "test(bookings): lock cowork_only stickiness in state machine"
```

---

### Task 7: Wire the Notion webhook `cowork_only` action

**Files:**
- Modify: `app/api/webhooks/notion/[workspace]/route.ts` (import list ~line 9-20; new branch after the `if (!booking)` block ~line 166)

This branch is verified by `npm run typecheck` + the manual checklist in Task 8 (the repo does not unit-test the webhook route handler; see `tests/unclaim.test.ts`, which tests only the email). Do NOT claim it is tested by an automated test.

- [ ] **Step 1: Add the import**

In the `from "@/lib/db/bookings"` import block (lines 9-20), add `acceptCoworkOnly`:

```ts
import {
  getBookingByNotionPageId,
  getBookingById,
  claimBooking,
  reassignBooking,
  releaseBooking,
  setBookedByEmail,
  setBookingSlot,
  helperHasSlotConflict,
  setLumaStatus,
  resetAssignment,
  acceptCoworkOnly,
} from "@/lib/db/bookings";
```

- [ ] **Step 2: Add the action branch**

In `processNotionWebhook`, immediately after the `if (!booking) { ... }` block (after line 166) and BEFORE the `if (action === "unclaim")` block, insert:

```ts
    // COWORK ONLY — an organizer accepts an unclaimed 1:1 registrant for
    // coworking (Dev workspace button). No page read needed: we act on the
    // resolved booking. acceptCoworkOnly is the atomic arbiter (first-wins vs a
    // racing claim) and is idempotent (a second click → noop).
    if (action === "cowork_only") {
      const result = await acceptCoworkOnly(booking.id);
      if (result.status === "rejected") {
        await logSync({ direction, result: "applied", bookingId: booking.id, action: "cowork_accept_rejected", note: result.reason });
        return NextResponse.json({ received: true, rejected: result.reason });
      }
      if (result.status === "noop") {
        await logSync({ direction, result: "applied", bookingId: booking.id, action: "cowork_accept_noop" });
        return NextResponse.json({ received: true, noop: true });
      }
      const accepted = result.booking;
      // Exactly one acceptance email (idempotent via email_log).
      await sendBookingComms(accepted.id, "cowork_only_accept");
      // Approve in Luma too so they keep a ticket + leave the pending pool
      // (best-effort; a failure must not undo the hub state change).
      try {
        const ev = await getEventById(accepted.event_id);
        if (ev?.luma_event_id && accepted.luma_guest_id) {
          await updateGuestStatus({
            eventLumaId: ev.luma_event_id,
            guestLumaId: accepted.luma_guest_id,
            status: "approved",
            apiKey: await apiKeyForCalendar(ev.luma_calendar),
          });
        } else {
          await logSync({ direction, result: "applied", bookingId: accepted.id, action: "cowork_accept_luma_skip", note: "missing event/guest luma id" });
        }
      } catch (err) {
        await logSync({ direction, result: "error", bookingId: accepted.id, action: "cowork_accept_luma_error", note: err instanceof Error ? err.message : String(err) });
      }
      // Mirror the new state (Status = Cowork only, Luma = Approved) to both cards.
      await pushBookingToWorkspaces(accepted);
      await logSync({ direction, result: "applied", bookingId: accepted.id, action: "cowork_accepted" });
      return NextResponse.json({ received: true });
    }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (`getEventById`, `updateGuestStatus`, `apiKeyForCalendar`, `pushBookingToWorkspaces`, `sendBookingComms`, `logSync` are already imported in this file.)

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no new errors in the modified files.

- [ ] **Step 5: Commit**

```bash
git add "app/api/webhooks/notion/[workspace]/route.ts"
git commit -m "feat(webhook): cowork_only action accepts registrant for coworking"
```

---

### Task 8: Full verification + manual Notion setup

**Files:** none (verification + operator setup)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, including the new `cowork-accept-template`, `cowork-accept`, and the extended `notion-mappers`, `decline-pending`, `bookings-status` files.

- [ ] **Step 2: Typecheck + lint the whole project**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 3: Regenerate types from remote (confirm the enum matches)**

Run: `npm run gen:types` then `git diff lib/supabase/types.ts`
Expected: no diff (Task 1 Step 4 already matches what the remote generates). If there is a diff, keep the generated version and re-run typecheck.

- [ ] **Step 4: Manual Notion setup (operator — document for Nancy)**

In the **Notion Dev** bookings database:
1. Add a **"Cowork only"** option to the **Status** select property (color: yellow, to match the schema).
2. Add a database button property named **"Cowork only"** with a single **Send webhook** action:
   - URL: `https://<hub-domain>/api/webhooks/notion/dev`
   - Headers: `x-webhook-secret: <NOTION_DEV_WEBHOOK_SECRET>` and `x-action: cowork_only`
   - Body: the page (matches the existing claim/unclaim buttons — the hub reads `data.id`).
   - No "Edit property" step is required: the hub sets Status → "Cowork only" and Luma Status → "Approved" and mirrors both cards.
3. (Optional) Restrict the button's visibility to a view filtered to `Status = Unassigned` so organizers only see it on eligible rows. Eligibility is still enforced server-side regardless.

- [ ] **Step 5: Manual end-to-end verification (staging or a test booking)**

1. Pick an `unassigned`, `pending` test registrant. Click **Cowork only** in Notion Dev.
2. Confirm: Status → "Cowork only", Luma Status → "Approved" on both cards; the guest received exactly one cowork acceptance email; a `cowork_accepted` row exists in `sync_log`; one `cowork_only_accept` row in `email_log`.
3. Click **Cowork only** again → confirm no second email (a `cowork_accept_noop` `sync_log` entry; no new `email_log` row).
4. Try the button on an `assigned` booking → confirm it's refused (`cowork_accept_rejected` note `assigned`), the claim untouched.
5. Confirm the day-before decline cron leaves the cowork-only registrant alone (they are `approved`, and `cowork_only`).

- [ ] **Step 6: Update the memory note (optional)**

If the manual Notion button/status setup is a recurring per-workspace step, add/extend a memory note so the operator setup isn't lost.

---

## Self-review

**Spec coverage:**
- Cowork-only action in organizer view → Task 7 (Notion Dev button) + Task 8 manual setup. ✓
- Available only for eligible unclaimed registrants → Task 4 (`status='unassigned'` guard + `classifyCoworkAcceptMiss`) + Task 8 optional filtered view. ✓
- Reuse existing status model → Task 1/2 (`cowork_only` sibling of `no_help_needed`). ✓
- Prevent accidental 1:1 claim → `cowork_only` ≠ `unassigned`, so `claimBooking` can't touch it; atomic race guard (Task 4). ✓
- Explicit status change for exceptions → `decideBookingStatusPatch` allows a manual Notion Status edit; sticky only against Luma echoes (Task 6). ✓
- Idempotent (no dup emails / records) → atomic UPDATE `noop` + `email_log` reserve (Task 4 + Task 3). ✓
- Status/email logging → `sync_log` + `email_log` (Task 7). ✓
- Email core message + no-guarantee disclaimer + reuse template/styling/event data → Task 3. ✓
- Cutoff excludes cowork-only → Task 5 (+ `luma_status='approved'`). ✓
- Existing claimed/declined/unclaimed flows keep working → no changes to those paths; Task 8 Step 1 full suite. ✓

**Placeholder scan:** `<NNNN>` (migration number) and `<hub-domain>` / secret in Task 8 are real operator inputs, resolved by the given commands — not code placeholders. No "TBD"/"handle edge cases"/omitted code.

**Type consistency:** `CommsKind` `"cowork_only_accept"` matches `RECIPIENTS` key and `templateKeyFor` → `"cowork_only_accept__guest"` matches the `TEMPLATE_REGISTRY` key and `TemplateKey`. `acceptCoworkOnly` returns `CoworkAcceptResult`; the route branch handles `rejected` / `noop` / `accepted` exactly as defined. `classifyCoworkAcceptMiss` reasons (`not_found | filtered | assigned | ineligible`) match the type union.
