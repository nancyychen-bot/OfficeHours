# Non-Free Day-Before Checklist + Drop Slot-Change from T-1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a day-before (T-1) "what to bring" checklist email for approved non-Free guests (no Notion AI step, no slot-change line), and remove the "Change your slot" line from the existing Free day-before email.

**Architecture:** New `prep_reminder_day_before_paid` comms kind + template; a non-Free eligibility predicate + T-1 senders added to `lib/events/prep.ts` and wired into the existing prep-reminder cron. Edit the Free day-before template to drop the slot-change line. `email_log` migration + editor visibility.

**Tech Stack:** TypeScript, Next.js cron route, Vitest, Supabase (email_log constraint).

**Reference spec:** `docs/superpowers/specs/2026-08-24-day-before-paid-checklist-design.md`

---

## File Structure
- **Create** `supabase/migrations/0047_email_log_day_before_paid.sql` — allow the new kind.
- **Modify** `lib/email/templates.ts` — new `prep_reminder_day_before_paid` kind + template; drop the change-slot line from `prep_reminder_day_before__guest`.
- **Modify** `lib/email/comms.ts` — `RECIPIENTS.prep_reminder_day_before_paid = ["guest"]`.
- **Modify** `components/hub/EmailEditor.tsx` — list the new template under "Before the event".
- **Modify** `lib/events/prep.ts` — `isEligibleForDayBeforePaid` + `sendPrepDayBeforePaidForEvent` + `sendPrepDayBeforePaidForLeadWindow`.
- **Modify** `app/api/cron/prep-reminder/route.ts` — fire the new sender at T-1.
- **Modify** `tests/comms-templates.test.ts`, `tests/prep.test.ts`.

---

## Task 1: email_log migration

**Files:**
- Create: `supabase/migrations/0047_email_log_day_before_paid.sql`

- [ ] **Step 1: Create the migration** (0045's list + the new kind)

```sql
-- ============================================================================
-- 0047 — prep_reminder_day_before_paid comms kind (T-1 checklist, non-Free guests)
-- ============================================================================
alter table email_log drop constraint email_log_event_kind_check;
alter table email_log add constraint email_log_event_kind_check
  check (event_kind in (
    'assigned', 'checked_in', 'no_show', 'cancelled', 'expert_unavailable',
    'declined', 'waitlisted', 'event_cancelled', 'arrived_after_no_show',
    'double_booked', 'feedback_request', 'prep_reminder', 'rematch_pending',
    'unmatched_notice', 'reassigned_off', 'already_claimed', 'day_of_agenda',
    'unclaim_denied', 'slot_changed', 'prep_reminder_day_before', 'cowork_only',
    'guest_cancelled', 'prep_reminder_day_before_paid'
  ));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0047_email_log_day_before_paid.sql
git commit -m "feat(day-before): email_log migration for prep_reminder_day_before_paid"
```
(Applied to Supabase at rollout, not now.)

---

## Task 2: New kind + template, drop slot-change from Free day-before, editor

**Files:**
- Modify: `lib/email/templates.ts`, `lib/email/comms.ts`, `components/hub/EmailEditor.tsx`
- Test: `tests/comms-templates.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/comms-templates.test.ts` inside the `describe("renderComms", …)` block:

```ts
  it("prep_reminder_day_before_paid → guest: what to bring, no Notion AI, no slot change", () => {
    const r = renderComms("prep_reminder_day_before_paid", "guest", fields())!;
    expect(r.text).toContain("What to bring");
    expect(r.text).toContain("Your laptop");
    expect(r.text).not.toContain("Notion AI");
    expect(r.text).not.toContain("Change your slot");
  });
  it("Free day-before no longer offers a slot change (too late at T-1)", () => {
    const r = renderComms("prep_reminder_day_before", "guest", fields())!;
    expect(r.text).not.toContain("Change your slot");
    // T-3 prep still offers it (changes still possible that far out):
    expect(renderComms("prep_reminder", "guest", fields())!.text).toContain("Change your slot");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/comms-templates.test.ts`
Expected: FAIL — `"prep_reminder_day_before_paid"` not in `CommsKind`, and the Free day-before still has the slot-change line.

- [ ] **Step 3: Add the kind, recipient, template; drop the Free slot-change line**

In `lib/email/templates.ts`:

Append `| "prep_reminder_day_before_paid"` to the END of the `CommsKind` union line (currently ends `… | "guest_cancelled"`).

Add to the `TemplateKey` union (near the other prep keys):
```ts
  | "prep_reminder_day_before_paid__guest"
```

In `prep_reminder_day_before__guest`, **delete** this line (and only this line) from the `body`:
```ts
      "Need a different time? **[Change your slot]({{slotChangeLink}})** and we'll help reassign you.", "",
```

Add the new template entry immediately after `prep_reminder_day_before__guest`:
```ts
  prep_reminder_day_before_paid__guest: {
    label: "Prep reminder — day before (non-Free)", description: "1 day before — approved guests not on Free", role: "guest",
    subject: "Your Notion Build Bar 1:1 is tomorrow ✨",
    body: b(
      "Hi {{firstName}},", "",
      "Quick reminder — your **Notion Build Bar** session is **tomorrow**. We can't wait to build with you!", "",
      "**What to bring:**",
      "✅ Your 1:1 slot — check for the calendar invite (if you have one)",
      "✅ Your laptop", "",
      "Can't make it? Please **[cancel your registration]({{eventUrl}})** so we can free up your spot.", "",
      "See you tomorrow,", SIGNOFF, "", `*${SUPPORT}*`,
    ),
  },
```

In `lib/email/comms.ts`, add to `RECIPIENTS` after the `prep_reminder_day_before: ["guest"],` line:
```ts
  prep_reminder_day_before_paid: ["guest"],
```

In `components/hub/EmailEditor.tsx`, add the new key to the "Before the event" stage's `keys` array:
```ts
    keys: ["prep_reminder__guest", "prep_reminder_day_before__guest", "prep_reminder_day_before_paid__guest"],
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/comms-templates.test.ts && npm run typecheck`
Expected: PASS + clean (`RECIPIENTS` typed `Record<CommsKind, Recipient[]>` forces the new entry).

- [ ] **Step 5: Commit**

```bash
git add lib/email/templates.ts lib/email/comms.ts components/hub/EmailEditor.tsx tests/comms-templates.test.ts
git commit -m "feat(day-before): non-Free day-before template; drop slot-change from Free day-before"
```

---

## Task 3: Non-Free predicate + T-1 senders + cron

**Files:**
- Modify: `lib/events/prep.ts`
- Modify: `app/api/cron/prep-reminder/route.ts`
- Test: `tests/prep.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/prep.test.ts` (the `base` fixture defaults `notion_plan: "Free"`):

```ts
import { isEligibleForDayBeforePaid } from "../lib/events/prep";

describe("isEligibleForDayBeforePaid", () => {
  it("includes approved non-Free (paid or blank plan)", () => {
    expect(isEligibleForDayBeforePaid(base({ notion_plan: "Business" }))).toBe(true);
    expect(isEligibleForDayBeforePaid(base({ notion_plan: null as unknown as string }))).toBe(true);
  });
  it("excludes Free, non-approved, cancelled, filtered, or no email", () => {
    expect(isEligibleForDayBeforePaid(base({ notion_plan: "Free" }))).toBe(false);
    expect(isEligibleForDayBeforePaid(base({ notion_plan: "Business", luma_status: "pending" }))).toBe(false);
    expect(isEligibleForDayBeforePaid(base({ notion_plan: "Business", status: "cancelled" }))).toBe(false);
    expect(isEligibleForDayBeforePaid(base({ notion_plan: "Business", filtered: true }))).toBe(false);
    expect(isEligibleForDayBeforePaid(base({ notion_plan: "Business", guest_email: "" }))).toBe(false);
  });
});
```
(Add `isEligibleForDayBeforePaid` to the existing top import from `../lib/events/prep`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/prep.test.ts`
Expected: FAIL — `isEligibleForDayBeforePaid` not exported.

- [ ] **Step 3: Add the predicate + senders**

In `lib/events/prep.ts`, add after `isEligibleForPrep`:
```ts
/**
 * A booking that should get the NON-Free day-before checklist: an APPROVED guest
 * NOT on the Free plan (paid plans and blank/unknown), with an email, not filtered,
 * not cancelled. Complements isEligibleForPrep so every approved guest gets exactly
 * one day-before checklist. No Notion AI step (that's the Free nudge).
 */
export function isEligibleForDayBeforePaid(b: Booking): boolean {
  return (
    b.luma_status === "approved" &&
    b.notion_plan !== "Free" &&
    !b.filtered &&
    !!b.guest_email &&
    b.status !== "cancelled"
  );
}

/** Send the non-Free day-before checklist to every eligible guest of one event. Idempotent. */
export async function sendPrepDayBeforePaidForEvent(eventId: string): Promise<number> {
  const eligible = (await listBookingsForEvent(eventId)).filter(isEligibleForDayBeforePaid);
  for (const b of eligible) await sendBookingComms(b.id, "prep_reminder_day_before_paid");
  return eligible.length;
}

/** Send the non-Free day-before checklist for every event happening tomorrow (now + 1). */
export async function sendPrepDayBeforePaidForLeadWindow(now: Date = new Date()): Promise<{ events: number; guests: number }> {
  const events = await listEventsByDate(isoDatePlusDays(now, 1));
  let guests = 0;
  for (const ev of events) guests += await sendPrepDayBeforePaidForEvent(ev.id);
  return { events: events.length, guests };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/prep.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into the prep-reminder cron**

In `app/api/cron/prep-reminder/route.ts`:
- Add `sendPrepDayBeforePaidForLeadWindow` to the existing import from `@/lib/events/prep`.
- After `const dayBefore = await sendPrepDayBeforeForLeadWindow();`, add:
```ts
  const dayBeforePaid = await sendPrepDayBeforePaidForLeadWindow();
```
- In the `logSync` `note`, append the paid counts:
```ts
    note: `lead=${PREP_LEAD_DAYS}d events=${prep.events} guests=${prep.guests}; dayBefore events=${dayBefore.events} guests=${dayBefore.guests}; dayBeforePaid events=${dayBeforePaid.events} guests=${dayBeforePaid.guests}`,
```
- Add `dayBeforePaid` to the returned JSON: `return NextResponse.json({ prep, dayBefore, dayBeforePaid });`

- [ ] **Step 6: Verify typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/events/prep.ts app/api/cron/prep-reminder/route.ts tests/prep.test.ts
git commit -m "feat(day-before): non-Free eligibility + T-1 sender wired into prep cron"
```

---

## Self-Review Notes
- **Spec coverage:** new kind + template (T2), migration (T1), non-Free predicate + T-1 sender + cron (T3), drop slot-change from Free day-before (T2), editor visibility (T2). T-1-only (no T-3) — the new sender is only in the day-before window. `assigned__guest`/`prep_reminder` slot-change lines untouched (T2 removes from the Free day-before ONLY). All covered.
- **Placeholder scan:** none — full code each step.
- **Type consistency:** `prep_reminder_day_before_paid` kind, `prep_reminder_day_before_paid__guest` key, `isEligibleForDayBeforePaid`, `sendPrepDayBeforePaidFor{Event,LeadWindow}` used consistently across tasks.
- **Coverage complement:** `notion_plan !== "Free"` (T3) is the exact complement of `isEligibleForPrep`'s `=== "Free"`, so no approved guest gets both day-before emails and none is missed.
