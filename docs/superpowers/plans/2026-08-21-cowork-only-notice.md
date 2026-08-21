# Cowork-Only Notice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a guest who asked for "1:1 help" but booked no slot is approved, automatically email them that they're welcome to cowork but won't be paired 1:1 — plus a one-off backfill script (with a test-send mode) for already-approved guests.

**Architecture:** A pure predicate `isCoworkOnlyMismatch(booking)` gates a new `cowork_only` guest comms kind. The send is triggered inside the shared `applyLumaStatus` orchestrator on the transition to `approved` (where `declined`/`waitlisted` comms already live). A backfill script mirrors `send-prep.ts` and supports `--test <email>` to send one real rendered copy to the operator without touching real guests.

**Tech Stack:** TypeScript, Next.js, Vitest, Supabase (email_log constraint migration), Resend, tsx scripts.

**Reference spec:** `docs/superpowers/specs/2026-08-21-cowork-only-notice-design.md`

---

## File Structure

- **Create** `lib/events/cowork-notice.ts` — pure `isCoworkOnlyMismatch` predicate + `sendCoworkNoticeForEvent(eventId)` (real backfill) + `pickSampleCoworkBooking(eventId)` (representative booking for a test send).
- **Modify** `lib/email/templates.ts` — add `"cowork_only"` to `CommsKind`, `"cowork_only__guest"` to `TemplateKey`, and a `TEMPLATE_REGISTRY` entry.
- **Modify** `lib/email/comms.ts` — add `cowork_only: ["guest"]` to `RECIPIENTS`.
- **Modify** `lib/sync/approval.ts` — on `next === "approved"` + predicate, `sendComms(id, "cowork_only")`.
- **Create** `supabase/migrations/0044_email_log_cowork_only.sql` — allow the new `event_kind`.
- **Create** `scripts/send-cowork-notice.ts` — backfill + `--test <email>` mode.
- **Modify** `package.json` — add `"send:cowork"` script.
- **Create** `tests/cowork-notice.test.ts` — predicate fixture tests.
- **Modify** `tests/approval-apply.test.ts` — approval fires `cowork_only` for a mismatch only.
- **Modify** an existing comms-templates test file — render `cowork_only__guest`.

---

## Task 1: `email_log` migration for the new kind

**Files:**
- Create: `supabase/migrations/0044_email_log_cowork_only.sql`

- [ ] **Step 1: Create the migration** (copy of 0041's constraint, adding `cowork_only`)

```sql
-- ============================================================================
-- 0044 — cowork_only comms kind (approved, no-slot "1:1 help" guests)
-- ============================================================================
alter table email_log drop constraint email_log_event_kind_check;
alter table email_log add constraint email_log_event_kind_check
  check (event_kind in (
    'assigned', 'checked_in', 'no_show', 'cancelled', 'expert_unavailable',
    'declined', 'waitlisted', 'event_cancelled', 'arrived_after_no_show',
    'double_booked', 'feedback_request', 'prep_reminder', 'rematch_pending',
    'unmatched_notice', 'reassigned_off', 'already_claimed', 'day_of_agenda',
    'unclaim_denied', 'slot_changed', 'prep_reminder_day_before', 'cowork_only'
  ));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0044_email_log_cowork_only.sql
git commit -m "feat(cowork): email_log migration for cowork_only kind"
```

(The migration is applied against Supabase during rollout, not in this task.)

---

## Task 2: Add the `cowork_only` comms kind + template

**Files:**
- Modify: `lib/email/templates.ts`
- Modify: `lib/email/comms.ts`
- Test: an existing comms-templates test (find it in Step 1)

- [ ] **Step 1: Write the failing test**

Find the comms-templates test file:
```bash
grep -rl "renderComms\|templateKeyFor" tests/ | head
```
Use `tests/rematch.test.ts` as the reference for `renderComms`/`templateKeyFor` usage (it imports from `../lib/email/templates`). Add a new test file `tests/cowork-template.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { templateKeyFor, renderComms, SAMPLE_FIELDS } from "../lib/email/templates";

describe("cowork_only__guest", () => {
  it("routes to the guest template", () => {
    expect(templateKeyFor("cowork_only", "guest", SAMPLE_FIELDS)).toBe("cowork_only__guest");
  });

  it("renders a coworking + no-1:1 message", () => {
    const r = renderComms("cowork_only", "guest", SAMPLE_FIELDS)!;
    expect(r.subject.toLowerCase()).toContain("cowork");
    expect(r.subject.toLowerCase()).toContain("1:1");
    expect(r.text.toLowerCase()).toContain("cowork");
    expect(r.text).toMatch(/won't be paired|one-on-one|1:1/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/cowork-template.test.ts`
Expected: FAIL — TS error that `"cowork_only"` is not assignable to `CommsKind` / no `cowork_only__guest` key.

- [ ] **Step 3: Add the kind, recipient, template key, and registry entry**

In `lib/email/templates.ts`, append `| "cowork_only"` to the `CommsKind` union (end of the line at the top of the file):
```ts
... | "slot_changed" | "prep_reminder_day_before" | "cowork_only";
```

Add to the `TemplateKey` union (after `prep_reminder_day_before__guest`):
```ts
  | "cowork_only__guest"
```

Add this entry to `TEMPLATE_REGISTRY` (place it right after the `prep_reminder_day_before__guest` entry, before `assigned__guest`):
```ts
  cowork_only__guest: {
    label: "Cowork-only notice", description: "approved, no slot, asked for 1:1 — coworking only", role: "guest",
    subject: "You're approved to cowork at the Notion Build Bar (no 1:1 slot booked)",
    body: b(
      "Hi {{firstName}},", "",
      "You've been **approved to join us at the Notion Build Bar** in {{location}} on {{eventDate}} to **cowork** alongside Notion experts. We're excited to have you!", "",
      "One heads-up so you know what to expect: because a **1:1 time slot wasn't selected** during registration, you **won't be paired with a Notion expert for dedicated one-on-one help**. You're very welcome to come cowork, ask questions, and meet the team.", "",
      "Can't make it? Please **[cancel your registration]({{eventUrl}})** so we can free up your spot.", "",
      "See you there,", SIGNOFF, "", `*${SUPPORT}*`,
    ),
  },
```

In `lib/email/comms.ts`, add to the `RECIPIENTS` map (after `prep_reminder_day_before: ["guest"],`):
```ts
  cowork_only: ["guest"],
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/cowork-template.test.ts && npm run typecheck`
Expected: PASS (2 tests) and no type errors. If `RECIPIENTS` is typed `Record<CommsKind, Recipient[]>`, the typecheck forces the new entry — confirm it's present.

- [ ] **Step 5: Commit**

```bash
git add lib/email/templates.ts lib/email/comms.ts tests/cowork-template.test.ts
git commit -m "feat(cowork): cowork_only comms kind + guest template"
```

---

## Task 3: Pure `isCoworkOnlyMismatch` predicate

**Files:**
- Create: `lib/events/cowork-notice.ts`
- Test: `tests/cowork-notice.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cowork-notice.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isCoworkOnlyMismatch } from "../lib/events/cowork-notice";
import type { Booking } from "../lib/sync/types";

const bk = (over: Partial<Booking>): Booking =>
  ({ id: "b1", status: "no_help_needed", attend_reasons: "I need 1:1 help", ...over } as Booking);

describe("isCoworkOnlyMismatch", () => {
  it("true: no slot + asked for 1:1 help", () => {
    expect(isCoworkOnlyMismatch(bk({}))).toBe(true);
  });

  it("true: reason among several, case-insensitive", () => {
    expect(isCoworkOnlyMismatch(bk({ attend_reasons: "I want to cowork, I NEED 1:1 HELP" }))).toBe(true);
  });

  it("false: booked a slot (unassigned)", () => {
    expect(isCoworkOnlyMismatch(bk({ status: "unassigned" }))).toBe(false);
  });

  it("false: booked + assigned", () => {
    expect(isCoworkOnlyMismatch(bk({ status: "assigned" }))).toBe(false);
  });

  it("false: no-slot coworker who never asked for 1:1", () => {
    expect(isCoworkOnlyMismatch(bk({ attend_reasons: "I want to cowork" }))).toBe(false);
  });

  it("false: empty / null reasons", () => {
    expect(isCoworkOnlyMismatch(bk({ attend_reasons: "" }))).toBe(false);
    expect(isCoworkOnlyMismatch(bk({ attend_reasons: null }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/cowork-notice.test.ts`
Expected: FAIL — module `../lib/events/cowork-notice` not found.

- [ ] **Step 3: Create the module with the predicate only**

Create `lib/events/cowork-notice.ts`:

```ts
import type { Booking } from "../sync/types";

/**
 * A guest who asked for "1:1 help" in their reasons but booked no time slot
 * (so `status = no_help_needed`, no 1:1 possible). When such a guest is approved
 * they're coworking only — this predicate gates the clarification email.
 * Independent of `luma_status`; the caller fires it on the transition to approved.
 */
export function isCoworkOnlyMismatch(booking: Booking): boolean {
  return (
    booking.status === "no_help_needed" &&
    !!booking.attend_reasons &&
    booking.attend_reasons.toLowerCase().includes("1:1 help")
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/cowork-notice.test.ts`
Expected: PASS (6 tests). If `Booking` lacks `attend_reasons`, confirm the column exists in `lib/supabase/types.ts` (`bookings`/`booking_details` Row) — it should be `attend_reasons: string | null`. If the field name differs, match the real one and update the test fixture.

- [ ] **Step 5: Commit**

```bash
git add lib/events/cowork-notice.ts tests/cowork-notice.test.ts
git commit -m "feat(cowork): pure isCoworkOnlyMismatch predicate + tests"
```

---

## Task 4: Fire `cowork_only` on approval in `applyLumaStatus`

**Files:**
- Modify: `lib/sync/approval.ts`
- Test: `tests/approval-apply.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/approval-apply.test.ts`, inside the existing `describe("applyLumaStatus", …)` block:

```ts
  it("approving a no-slot 1:1 guest sends cowork_only", async () => {
    const d = deps();
    await applyLumaStatus(
      booking({ status: "no_help_needed", attend_reasons: "I need 1:1 help", luma_status: "pending" }),
      "approved", { source: "dev" }, d,
    );
    expect(d.sendComms).toHaveBeenCalledWith("b1", "cowork_only");
  });

  it("approving a slot-booker does NOT send cowork_only", async () => {
    const d = deps();
    await applyLumaStatus(
      booking({ status: "unassigned", attend_reasons: "I need 1:1 help" }),
      "approved", { source: "dev" }, d,
    );
    expect(d.sendComms).not.toHaveBeenCalledWith("b1", "cowork_only");
  });

  it("declining a no-slot 1:1 guest never sends cowork_only", async () => {
    const d = deps();
    await applyLumaStatus(
      booking({ status: "no_help_needed", attend_reasons: "I need 1:1 help" }),
      "declined", { source: "dev" }, d,
    );
    expect(d.sendComms).not.toHaveBeenCalledWith("b1", "cowork_only");
  });
```

Note: the existing `booking()` fixture may not set `attend_reasons`; passing it via the `over` param (as above) is sufficient because the fixture spreads `...p`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/approval-apply.test.ts`
Expected: FAIL — `cowork_only` not sent (branch missing); the first test fails its assertion.

- [ ] **Step 3: Add the approved branch**

In `lib/sync/approval.ts`, add the import at the top (after the existing imports):
```ts
import { isCoworkOnlyMismatch } from "../events/cowork-notice";
```

Then in `applyLumaStatus`, after the `setLumaStatus` line and alongside the existing declined/waitlist block, add:
```ts
  if (next === "approved" && isCoworkOnlyMismatch(booking)) {
    await deps.sendComms(booking.id, "cowork_only");
  }
```
Place it immediately after the `if (next === "declined" || next === "waitlist") { … }` block (before the Luma-writeback block). Use `booking` (the input) for the predicate — the approval transition doesn't change the assignment axis.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/approval-apply.test.ts && npm run typecheck`
Expected: PASS (all existing + 3 new) and no type errors. **Watch for an import cycle**: `approval.ts` → `events/cowork-notice.ts`. `cowork-notice.ts` may import `db`/`email` modules for its sender functions (added in Task 5) — verify none of those transitively import `lib/sync/approval.ts`. If a cycle appears (typecheck or a runtime `undefined` import), move `isCoworkOnlyMismatch` into its own leaf module `lib/events/cowork-predicate.ts` (importing only the `Booking` type) and import it from both `approval.ts` and `cowork-notice.ts`; update the Task 3 test import accordingly.

- [ ] **Step 5: Commit**

```bash
git add lib/sync/approval.ts tests/approval-apply.test.ts
git commit -m "feat(cowork): send cowork_only on approval of no-slot 1:1 guests"
```

---

## Task 5: Backfill senders + script (with test-send)

**Files:**
- Modify: `lib/events/cowork-notice.ts`
- Create: `scripts/send-cowork-notice.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the senders to `lib/events/cowork-notice.ts`**

Append to `lib/events/cowork-notice.ts` (keep the existing predicate):
```ts
import { listBookingsForEvent } from "../db/bookings";
import { sendBookingComms, sendCommsToEmail } from "../email/comms";

/** Approved, no-slot "1:1 help" guests of an event (the backfill audience). */
export function selectCoworkOnlyBackfill(bookings: Booking[]): Booking[] {
  return bookings.filter((b) => b.luma_status === "approved" && isCoworkOnlyMismatch(b));
}

/** Send the cowork-only notice to every qualifying approved guest of one event. Idempotent. */
export async function sendCoworkNoticeForEvent(eventId: string): Promise<number> {
  const eligible = selectCoworkOnlyBackfill(await listBookingsForEvent(eventId));
  for (const b of eligible) await sendBookingComms(b.id, "cowork_only");
  return eligible.length;
}

/**
 * Send ONE real rendered cowork_only email to `testEmail` using a representative
 * qualifying booking of the event — for eyeballing before a real backfill.
 * email_log is keyed on the recipient address, so this writes no row for any real
 * guest and never blocks the later real send. Returns the sample booking id, or
 * null if the event has no qualifying guest.
 */
export async function sendCoworkNoticeTest(eventId: string, testEmail: string): Promise<string | null> {
  const [sample] = selectCoworkOnlyBackfill(await listBookingsForEvent(eventId));
  if (!sample) return null;
  await sendCommsToEmail(sample.id, "cowork_only", "guest", testEmail);
  return sample.id;
}
```
(Put the two new `import` lines at the top of the file with the existing type import. If Task 4 required splitting the predicate into `cowork-predicate.ts`, import `isCoworkOnlyMismatch` from there.)

- [ ] **Step 2: Verify it typechecks + existing tests pass**

Run: `npm run typecheck && npm test -- tests/cowork-notice.test.ts`
Expected: no type errors; predicate tests still pass. Confirm `sendCommsToEmail` is exported from `lib/email/comms.ts` (it is — used by `app/api/webhooks/notion/[workspace]/route.ts`).

- [ ] **Step 3: Create the script**

Create `scripts/send-cowork-notice.ts` (mirrors `scripts/send-prep.ts`):
```ts
/**
 * Backfill the cowork-only notice for one event's already-approved guests
 * (approved + no slot + asked for "1:1 help"). Going forward this sends
 * automatically on approval; this is for the initial backfill / ad-hoc sends.
 *
 * Usage:
 *   # test: send ONE real rendered copy to yourself, touching no real guests
 *   npm run send:cowork -- --event <event-id> --test you@example.com
 *   # dry run: list who would receive it
 *   npm run send:cowork -- --event <event-id> --dry-run
 *   # real: send to all qualifying guests (dedup-safe)
 *   npm run send:cowork -- --event <event-id>
 */
import { listBookingsForEvent } from "../lib/db/bookings";
import { getEventById } from "../lib/db/events";
import {
  selectCoworkOnlyBackfill,
  sendCoworkNoticeForEvent,
  sendCoworkNoticeTest,
} from "../lib/events/cowork-notice";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const eventId = arg("--event");
  const testEmail = arg("--test");
  const dryRun = process.argv.includes("--dry-run");
  if (!eventId) {
    console.error("Missing --event <event-id>");
    process.exit(1);
  }
  const event = await getEventById(eventId);
  if (!event) {
    console.error(`No event ${eventId}`);
    process.exit(1);
  }

  const eligible = selectCoworkOnlyBackfill(await listBookingsForEvent(eventId));
  console.log(`Event: ${event.name} (${event.event_date})`);
  console.log(`Qualifying guests: ${eligible.length}`);
  for (const b of eligible) console.log(`  - ${b.guest_name} <${b.guest_email}>`);

  if (testEmail) {
    const sampleId = await sendCoworkNoticeTest(eventId, testEmail);
    console.log(
      sampleId
        ? `\n[test] sent one sample copy (booking ${sampleId}) to ${testEmail}. No real guests emailed.`
        : `\n[test] no qualifying guest to sample from.`,
    );
    return;
  }
  if (dryRun) {
    console.log("\n[dry-run] no emails sent.");
    return;
  }
  const n = await sendCoworkNoticeForEvent(eventId);
  console.log(`\nRequested cowork-only notices for ${n} guest(s). (Dedup skips anyone already emailed.)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
```

- [ ] **Step 4: Add the npm script**

In `package.json`, add alongside the other `send:*` scripts (after `"send:prep"`):
```json
    "send:cowork": "tsx --env-file=.env.local scripts/send-cowork-notice.ts",
```

- [ ] **Step 5: Verify typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass (existing + new cowork tests). Validate `package.json` parses: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'));console.log('ok')"` → `ok`.

- [ ] **Step 6: Commit**

```bash
git add lib/events/cowork-notice.ts scripts/send-cowork-notice.ts package.json
git commit -m "feat(cowork): backfill sender + send:cowork script with --test mode"
```

---

## Self-Review Notes

- **Spec coverage:** predicate = Task 3; comms kind + template + recipient + subject = Task 2; email_log migration = Task 1; on-approval trigger in `applyLumaStatus` (with no false-fire on claim auto-approve since those are `assigned`) = Task 4; backfill script + `--test` gate + `send:cowork` = Task 5. All spec sections covered.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `isCoworkOnlyMismatch`, `selectCoworkOnlyBackfill`, `sendCoworkNoticeForEvent`, `sendCoworkNoticeTest`, comms kind `"cowork_only"`, template key `"cowork_only__guest"` used consistently across Tasks 2–5. `attend_reasons` (snake_case, the DB column) used in predicate and tests.
- **Idempotency/safety:** `email_log` dedup on (booking, kind, email) gives idempotent auto-send and dedup-safe re-runs; test-send keyed on the operator address writes no guest row.
