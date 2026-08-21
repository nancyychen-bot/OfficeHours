# Guest-Cancelled Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distinguish a guest self-cancellation (Luma-origin) from an organizer decline (Notion-origin): a guest cancel now notifies only the assigned expert via a new `guest_cancelled` email (guest gets nothing), while the organizer-decline `declined` email keeps its "at capacity" wording.

**Architecture:** Add an expert-only `guest_cancelled` comms kind + template. Change the one Luma-origin downgrade line in `ingestRegistration` to send `guest_cancelled` (only when an expert was assigned) instead of `declined`. The decision is a pure, unit-tested helper in a leaf module so it imports no heavy deps. `applyLumaStatus` (Notion/cron decline) is untouched.

**Tech Stack:** TypeScript, Next.js, Vitest, Supabase (email_log constraint migration), Resend.

**Reference spec:** `docs/superpowers/specs/2026-08-21-guest-cancelled-vs-declined-design.md`

---

## File Structure

- **Create** `supabase/migrations/0045_email_log_guest_cancelled.sql` — allow the new `event_kind`.
- **Modify** `lib/email/templates.ts` — add `"guest_cancelled"` to `CommsKind`, `"guest_cancelled__helper"` to `TemplateKey` + `TEMPLATE_REGISTRY`.
- **Modify** `lib/email/comms.ts` — `RECIPIENTS.guest_cancelled = ["helper"]`; add `"guest_cancelled"` to `CANCEL_CALENDAR_KINDS`.
- **Create** `lib/events/cancellation.ts` — pure `shouldSendGuestCancelled(prior, nextLumaStatus)`.
- **Modify** `lib/events/ingest.ts` — route the Luma-origin decline through the new helper + kind.
- **Modify** `tests/comms-templates.test.ts` — render tests for the new kind.
- **Create** `tests/cancellation.test.ts` — unit tests for the pure helper.

---

## Task 1: email_log migration

**Files:**
- Create: `supabase/migrations/0045_email_log_guest_cancelled.sql`

- [ ] **Step 1: Create the migration** (copy of 0044's constraint, adding `guest_cancelled`)

```sql
-- ============================================================================
-- 0045 — guest_cancelled comms kind (expert notified when a guest self-cancels)
-- ============================================================================
alter table email_log drop constraint email_log_event_kind_check;
alter table email_log add constraint email_log_event_kind_check
  check (event_kind in (
    'assigned', 'checked_in', 'no_show', 'cancelled', 'expert_unavailable',
    'declined', 'waitlisted', 'event_cancelled', 'arrived_after_no_show',
    'double_booked', 'feedback_request', 'prep_reminder', 'rematch_pending',
    'unmatched_notice', 'reassigned_off', 'already_claimed', 'day_of_agenda',
    'unclaim_denied', 'slot_changed', 'prep_reminder_day_before', 'cowork_only',
    'guest_cancelled'
  ));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0045_email_log_guest_cancelled.sql
git commit -m "feat(cancel): email_log migration for guest_cancelled kind"
```

(Applied to Supabase during rollout, not in this task.)

---

## Task 2: `guest_cancelled` comms kind + expert template

**Files:**
- Modify: `lib/email/templates.ts`
- Modify: `lib/email/comms.ts`
- Test: `tests/comms-templates.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/comms-templates.test.ts`, inside the existing `describe("renderComms", …)` block (near the `declined` tests):

```ts
  it("guest_cancelled → helper only, attributes it to the guest cancelling", () => {
    const h = renderComms("guest_cancelled", "helper", fields())!;
    expect(h.subject.toLowerCase()).toContain("freed");
    expect(h.text).toContain("cancelled their booking");
    expect(h.text).toContain("released");
    expect(h.text).not.toContain("at capacity");
  });
  it("guest_cancelled → guest gets nothing (expert-only kind)", () => {
    expect(renderComms("guest_cancelled", "guest", fields())).toBeNull();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/comms-templates.test.ts`
Expected: FAIL — TS error that `"guest_cancelled"` is not assignable to `CommsKind`.

- [ ] **Step 3: Add the kind, recipient, cancel-calendar membership, and template**

In `lib/email/templates.ts`:

Append `| "guest_cancelled"` to the END of the `CommsKind` union line (currently ends with `| "cowork_only"`):
```ts
... | "prep_reminder_day_before" | "cowork_only" | "guest_cancelled";
```

Add to the `TemplateKey` union (place near the `declined__*` entries):
```ts
  | "guest_cancelled__helper"
```

Add this entry to `TEMPLATE_REGISTRY` (immediately after the `declined__helper` entry):
```ts
  guest_cancelled__helper: {
    label: "Guest cancelled (slot freed)", description: "guest self-cancelled on Luma — expert notified", role: "helper",
    subject: "Slot freed — {{guestName}} won't be joining",
    body: b(
      "Hi {{firstName}},", "",
      "Quick update: {{guestName}} has cancelled their booking and won't be joining, so the slot you'd claimed has been released. Nothing you need to do.", "",
      SUPPORT_HELPER, "", "Thanks for building with us,", SIGNOFF,
    ),
  },
```

In `lib/email/comms.ts`:

Add to the `RECIPIENTS` map (after the `declined: ["guest", "helper"],` line):
```ts
  guest_cancelled: ["helper"],
```

Add `"guest_cancelled"` to the `CANCEL_CALENDAR_KINDS` set (after `"reassigned_off",`):
```ts
  "guest_cancelled",
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/comms-templates.test.ts && npm run typecheck`
Expected: PASS and no type errors. `RECIPIENTS` is typed `Record<CommsKind, Recipient[]>`, so the typecheck forces the new entry — confirm it's present.

- [ ] **Step 5: Commit**

```bash
git add lib/email/templates.ts lib/email/comms.ts tests/comms-templates.test.ts
git commit -m "feat(cancel): expert-only guest_cancelled comms kind + template"
```

---

## Task 3: Route Luma-origin declines to `guest_cancelled`

**Files:**
- Create: `lib/events/cancellation.ts`
- Test: `tests/cancellation.test.ts`
- Modify: `lib/events/ingest.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cancellation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldSendGuestCancelled } from "../lib/events/cancellation";
import type { Booking } from "../lib/sync/types";

const bk = (over: Partial<Booking>): Booking =>
  ({ id: "b1", booked_by_email: "expert@x.com", ...over } as Booking);

describe("shouldSendGuestCancelled", () => {
  it("true: declined + an expert was assigned", () => {
    expect(shouldSendGuestCancelled(bk({}), "declined")).toBe(true);
  });
  it("false: declined but no expert (unassigned / coworker)", () => {
    expect(shouldSendGuestCancelled(bk({ booked_by_email: null }), "declined")).toBe(false);
  });
  it("false: not a decline", () => {
    expect(shouldSendGuestCancelled(bk({}), "approved")).toBe(false);
    expect(shouldSendGuestCancelled(bk({}), "waitlist")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/cancellation.test.ts`
Expected: FAIL — module `../lib/events/cancellation` not found.

- [ ] **Step 3: Create the pure helper (leaf module, types only)**

Create `lib/events/cancellation.ts`:

```ts
import type { Booking, LumaStatus } from "../sync/types";

/**
 * A Luma-origin decline is a guest self-cancellation (the team triages in Notion,
 * so Luma-side declines come from the guest going "Not Going"). Notify the expert
 * only when the 1:1 was actually claimed; the guest gets nothing (they cancelled
 * it themselves and Luma already confirms it).
 */
export function shouldSendGuestCancelled(prior: Booking, nextLumaStatus: LumaStatus): boolean {
  return nextLumaStatus === "declined" && !!prior.booked_by_email;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/cancellation.test.ts`
Expected: PASS (3 tests). If `Booking`/`LumaStatus` aren't exported from `lib/sync/types`, confirm the exports (`Booking` and `LumaStatus` are both there — used across `lib/sync/approval.ts`).

- [ ] **Step 5: Wire it into ingest**

In `lib/events/ingest.ts`, add the import near the other `../` imports:
```ts
import { shouldSendGuestCancelled } from "./cancellation";
```

Replace the Luma-origin downgrade block. It currently reads (around line 40):
```ts
    if (nextLumaStatus === "declined") await sendBookingComms(prior.id, "declined");
    else if (nextLumaStatus === "waitlist") await sendBookingComms(prior.id, "waitlisted");
```
with:
```ts
    if (shouldSendGuestCancelled(prior, nextLumaStatus)) await sendBookingComms(prior.id, "guest_cancelled");
    else if (nextLumaStatus === "waitlist") await sendBookingComms(prior.id, "waitlisted");
```

This means: a Luma-origin decline of a **claimed** booking notifies the expert via
`guest_cancelled`; a Luma-origin decline of an unassigned/coworker booking sends
nothing (the guest gets nothing either way). The `declined` email is no longer sent
from the Luma path — it now fires only from `applyLumaStatus` (Notion/cron), which
is unchanged.

- [ ] **Step 6: Verify typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass. The existing `declined → guest gets the at-capacity note` and `declined → helper gets a slot-freed note` template tests still pass (those templates are unchanged).

- [ ] **Step 7: Commit**

```bash
git add lib/events/cancellation.ts tests/cancellation.test.ts lib/events/ingest.ts
git commit -m "feat(cancel): Luma-origin declines notify expert via guest_cancelled"
```

---

## Self-Review Notes

- **Spec coverage:** origin routing (Task 3), expert-only `guest_cancelled` + template (Task 2), guest gets nothing (helper-only recipients + no guest template → `templateKeyFor` returns null, verified by test), audience gate = expert assigned (`shouldSendGuestCancelled`, Task 3), `declined__*` unchanged (not touched; existing tests lock the "reached capacity" copy), migration (Task 1). All covered.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `guest_cancelled` kind, `guest_cancelled__helper` key, `shouldSendGuestCancelled(prior, nextLumaStatus)` used consistently across Tasks 2–3. `LumaStatus` values (`declined`/`waitlist`/`approved`) match the enum.
- **Not touched:** `applyLumaStatus`, `declined__*` templates, waitlist path — intentionally unchanged.
