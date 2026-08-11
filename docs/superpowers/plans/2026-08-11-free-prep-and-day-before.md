# Free-only Prep + Day-before Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict the 3-day prep email to Approved + Free-plan guests (dropping the paid-plan disclaimer), and add a same-audience day-before reminder with its own editable template.

**Architecture:** One shared eligibility predicate (`isEligibleForPrep`) gains a `notion_plan === "Free"` clause and drives both sends. The day-before reminder is a new comms kind/template so it isn't swallowed by the 3-day send's `email_log` dedup and auto-appears on Settings → Emails. The existing daily prep cron fires both the T-3 and T-1 windows.

**Tech Stack:** Next.js 15 / TypeScript, Supabase (Postgres), Resend, Vitest.

**Reference spec:** `docs/superpowers/specs/2026-08-11-free-prep-and-day-before-design.md`

---

## File Structure

**Modified:**
- `lib/events/prep.ts` — `isEligibleForPrep` gains Free clause; add `sendPrepDayBeforeForEvent` + `sendPrepDayBeforeForLeadWindow`.
- `lib/email/templates.ts` — remove paid-plan disclaimer from `prep_reminder__guest`; add `prep_reminder_day_before` kind, `prep_reminder_day_before__guest` template key + registry entry.
- `lib/email/comms.ts` — `RECIPIENTS.prep_reminder_day_before = ["guest"]`.
- `app/api/cron/prep-reminder/route.ts` — also fire the day-before window.
- `supabase/migrations/0041_email_log_prep_day_before.sql` (create) — allow new `event_kind`.
- Tests: `tests/prep.test.ts` (extend), `tests/comms-templates.test.ts` (extend, if present — else add render assertion in prep test).

**Controller (not code tasks):** apply migration 0041; update the published `email_overrides.live_body` for `prep_reminder__guest` to drop the disclaimer.

**Build order:** predicate (T1) → prep copy cleanup (T2) → new template + kind + migration (T3) → senders (T4) → cron (T5) → verify (T6).

**Testing note:** `npm test`; single file `npx vitest run tests/<file>.test.ts`; `npm run typecheck`.

---

## Task 1: Narrow `isEligibleForPrep` to Free

**Files:**
- Modify: `lib/events/prep.ts`
- Test: `tests/prep.test.ts`

- [ ] **Step 1: Write the failing test (extend `tests/prep.test.ts`)**

```typescript
describe("isEligibleForPrep — Free plan only", () => {
  const free = { luma_status: "approved", notion_plan: "Free", guest_email: "a@x.com", status: "unassigned", filtered: false } as any;
  it("eligible for approved + Free", () => {
    expect(isEligibleForPrep(free)).toBe(true);
  });
  it("excluded for paid plans and null plan", () => {
    for (const plan of ["Plus", "Business", "Enterprise", null]) {
      expect(isEligibleForPrep({ ...free, notion_plan: plan })).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/prep.test.ts`
Expected: FAIL — the "excluded for paid plans" case currently returns true.

- [ ] **Step 3: Add the Free clause**

In `lib/events/prep.ts`, update `isEligibleForPrep`:

```typescript
export function isEligibleForPrep(b: Booking): boolean {
  return (
    b.luma_status === "approved" &&
    b.notion_plan === "Free" &&
    !b.filtered &&
    !!b.guest_email &&
    b.status !== "cancelled"
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/prep.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/events/prep.ts tests/prep.test.ts
git commit -m "feat(prep): restrict prep email to Free-plan approved guests"
```

---

## Task 2: Drop the paid-plan disclaimer from the prep copy

**Files:**
- Modify: `lib/email/templates.ts`

The published `live_body` override is what actually sends; the controller updates that separately (see controller steps). This task fixes the code default so a future re-publish / any workspace without the override is also correct.

- [ ] **Step 1: Remove the disclaimer line**

In `lib/email/templates.ts`, in the `prep_reminder__guest` body, delete this line (currently ~line 171) entirely:

```typescript
      "*Already on a Business or Enterprise plan, or used a trial before? You're all set — no need to sign up.*", "",
```

Leave the surrounding lines intact (the trial line above and the "Quick checklist" below).

- [ ] **Step 2: Verify typecheck + existing template tests**

Run: `npm run typecheck && npx vitest run tests/comms-templates.test.ts`
Expected: no type errors; template tests pass (they don't assert the removed line).

- [ ] **Step 3: Commit**

```bash
git add lib/email/templates.ts
git commit -m "change(prep): drop paid-plan disclaimer (prep is Free-only now)"
```

---

## Task 3: New day-before comms kind + template + migration

**Files:**
- Modify: `lib/email/templates.ts`, `lib/email/comms.ts`
- Create: `supabase/migrations/0041_email_log_prep_day_before.sql`
- Test: `tests/comms-templates.test.ts` (or `tests/prep.test.ts`)

- [ ] **Step 1: Add the kind + template key**

In `lib/email/templates.ts`, add `"prep_reminder_day_before"` to the `CommsKind` union (end is fine):

```typescript
... | "slot_changed" | "prep_reminder_day_before";
```

Add the template key to `TemplateKey` (next to `prep_reminder__guest`):

```typescript
  | "prep_reminder__guest"
  | "prep_reminder_day_before__guest"
```

- [ ] **Step 2: Add the registry entry**

In `TEMPLATE_REGISTRY`, add (after `prep_reminder__guest`):

```typescript
  prep_reminder_day_before__guest: {
    label: "Prep reminder — day before", description: "1 day before — approved Free-plan guests", role: "guest",
    subject: "Your Notion Build Bar 1:1 is tomorrow ✨",
    body: b(
      "Hi {{firstName}},", "",
      "Quick reminder — your **Notion Build Bar** session is **tomorrow**. We can't wait to build with you!", "",
      "**Quick checklist:**",
      "✅ Your 1:1 slot — check for the calendar invite (if you have one)",
      "✅ Notion AI activated — if you haven't yet, **[start your free Notion AI trial]({{trialLink}})** (about a minute)",
      "✅ Laptop + the question or workspace you want help with", "",
      "Can't make it? Please **[cancel your registration]({{eventUrl}})** so we can free up your spot.", "",
      "Need a different time? **[Change your slot]({{slotChangeLink}})** and we'll help reassign you.", "",
      "See you tomorrow,", SIGNOFF, "", `*${SUPPORT}*`,
    ),
  },
```

(`b`, `SIGNOFF`, `SUPPORT`, and the `{{firstName}}`/`{{trialLink}}`/`{{eventUrl}}`/`{{slotChangeLink}}` placeholders are all already defined/used by `prep_reminder__guest`.)

- [ ] **Step 3: Add the recipient mapping**

In `lib/email/comms.ts`, in `RECIPIENTS`, add (next to `prep_reminder: ["guest"]`):

```typescript
  prep_reminder_day_before: ["guest"],
```

- [ ] **Step 4: Create migration 0041**

`supabase/migrations/0041_email_log_prep_day_before.sql`:

```sql
-- ============================================================================
-- 0041 — prep_reminder_day_before comms kind (T-1 reminder to Free approved guests)
-- ============================================================================
alter table email_log drop constraint email_log_event_kind_check;
alter table email_log add constraint email_log_event_kind_check
  check (event_kind in (
    'assigned', 'checked_in', 'no_show', 'cancelled', 'expert_unavailable',
    'declined', 'waitlisted', 'event_cancelled', 'arrived_after_no_show',
    'double_booked', 'feedback_request', 'prep_reminder', 'rematch_pending',
    'unmatched_notice', 'reassigned_off', 'already_claimed', 'day_of_agenda',
    'unclaim_denied', 'slot_changed', 'prep_reminder_day_before'
  ));
```

- [ ] **Step 5: Write the failing render test**

Add to `tests/comms-templates.test.ts` (it already imports `renderComms` + `SAMPLE_FIELDS`; if not, mirror the existing render tests in that file):

```typescript
describe("prep_reminder_day_before__guest", () => {
  it("renders subject + body with the slot-change link", () => {
    const r = renderComms("prep_reminder_day_before", "guest", SAMPLE_FIELDS);
    expect(r.subject.toLowerCase()).toContain("tomorrow");
    expect(r.html).toContain("Change your slot");
    expect(r.text).toContain("tomorrow");
  });
});
```

- [ ] **Step 6: Run test + typecheck**

Run: `npx vitest run tests/comms-templates.test.ts && npm run typecheck`
Expected: PASS; no type errors (the new `CommsKind` is covered in `RECIPIENTS`, so the `Record<CommsKind, ...>` stays exhaustive).

- [ ] **Step 7: Commit**

```bash
git add lib/email/templates.ts lib/email/comms.ts supabase/migrations/0041_email_log_prep_day_before.sql tests/comms-templates.test.ts
git commit -m "feat(prep): day-before reminder template + comms kind"
```

---

## Task 4: Day-before senders

**Files:**
- Modify: `lib/events/prep.ts`
- Test: `tests/prep.test.ts`

- [ ] **Step 1: Write the failing selection test**

Add to `tests/prep.test.ts`:

```typescript
import { isoDatePlusDays } from "../lib/events/prep";

describe("day-before window date", () => {
  it("targets tomorrow (now + 1)", () => {
    const now = new Date("2026-08-25T20:00:00Z");
    expect(isoDatePlusDays(now, 1)).toBe("2026-08-26");
  });
});
```

- [ ] **Step 2: Run test to verify it fails/passes**

Run: `npx vitest run tests/prep.test.ts`
Expected: PASS if `isoDatePlusDays` already handles +1 (it's an existing exported helper). This test locks the behavior the sender relies on. (If it fails, `isoDatePlusDays` is broken — stop and report.)

- [ ] **Step 3: Add the senders**

In `lib/events/prep.ts`, add (after `sendPrepForLeadWindow`):

```typescript
/** Send the day-before reminder to every eligible guest of one event. Idempotent. */
export async function sendPrepDayBeforeForEvent(eventId: string): Promise<number> {
  const eligible = (await listBookingsForEvent(eventId)).filter(isEligibleForPrep);
  for (const b of eligible) await sendBookingComms(b.id, "prep_reminder_day_before");
  return eligible.length;
}

/** Send the day-before reminder for every event happening tomorrow (now + 1). */
export async function sendPrepDayBeforeForLeadWindow(now: Date = new Date()): Promise<{ events: number; guests: number }> {
  const events = await listEventsByDate(isoDatePlusDays(now, 1));
  let guests = 0;
  for (const ev of events) guests += await sendPrepDayBeforeForEvent(ev.id);
  return { events: events.length, guests };
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/prep.test.ts && npm run typecheck`
Expected: PASS; no type errors (`sendBookingComms(b.id, "prep_reminder_day_before")` typechecks now that the kind exists).

- [ ] **Step 5: Commit**

```bash
git add lib/events/prep.ts tests/prep.test.ts
git commit -m "feat(prep): day-before (T-1) send functions"
```

---

## Task 5: Fire the day-before window from the prep cron

**Files:**
- Modify: `app/api/cron/prep-reminder/route.ts`

- [ ] **Step 1: Extend the cron**

In `app/api/cron/prep-reminder/route.ts`, import the new sender and call both windows. Change the import line:

```typescript
import { sendPrepForLeadWindow, sendPrepDayBeforeForLeadWindow, PREP_LEAD_DAYS } from "@/lib/events/prep";
```

Replace the body after the auth check with:

```typescript
  const prep = await sendPrepForLeadWindow();
  const dayBefore = await sendPrepDayBeforeForLeadWindow();
  await logSync({
    direction: "luma_in",
    result: "applied",
    action: "prep_reminder_cron",
    note: `lead=${PREP_LEAD_DAYS}d events=${prep.events} guests=${prep.guests}; dayBefore events=${dayBefore.events} guests=${dayBefore.guests}`,
  });
  return NextResponse.json({ prep, dayBefore });
```

- [ ] **Step 2: Verify typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: no type errors; suite green.

- [ ] **Step 3: Commit**

```bash
git add "app/api/cron/prep-reminder/route.ts"
git commit -m "feat(prep): daily cron also sends the day-before reminder"
```

---

## Task 6: Full verification

**Files:** none

- [ ] **Step 1: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass; no type errors.

---

## Controller / rollout steps (not code tasks)

1. Apply migration 0041 to the live DB (Supabase MCP `apply_migration`) — required before the T-1 send can log/insert.
2. Update the published prep copy: in `email_overrides` row `key = 'prep_reminder__guest'`, remove the paragraph `*Already on a Business or Enterprise plan, or used a trial before? You're all set — no need to sign up.*` (and its blank line) from `live_body`, preserving the rest. (This is what actually sends.)
3. Deploy (merge to main). The day-before template appears on Settings → Emails automatically for editing.

---

## Self-Review

**Spec coverage:**
- Restrict prep to Free + Approved → Task 1. ✓
- Drop paid-plan disclaimer (code default + published override) → Task 2 (code) + controller step 2 (published). ✓
- New day-before template, own copy, editable on Settings → Task 3 (registry entry auto-lists on the page). ✓
- New comms kind + email_log CHECK → Task 3 + controller step 1. ✓
- Same audience for day-before → Tasks 4 reuse `isEligibleForPrep`. ✓
- Cron fires both windows → Task 5. ✓

**Placeholder scan:** none.

**Type consistency:** `prep_reminder_day_before` (CommsKind) ↔ `prep_reminder_day_before__guest` (TemplateKey) ↔ `RECIPIENTS.prep_reminder_day_before` ↔ `sendBookingComms(id, "prep_reminder_day_before")` are consistent across Tasks 3–4. `isEligibleForPrep` (Task 1) is the shared predicate used by both `sendPrepForEvent` (existing) and `sendPrepDayBeforeForEvent` (Task 4).
