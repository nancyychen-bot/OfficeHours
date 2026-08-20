# Auto-Decline Pending Guests (Day Before) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily cron that declines every still-`pending` booking for events happening tomorrow — sending the guest our `declined` email, writing `declined` back to Luma (no duplicate email), and mirroring `Declined` to both Notion workspaces.

**Architecture:** Reuse the existing `applyLumaStatus` orchestrator (it already does one correct decline: persist → email → Luma writeback → push to Notion). A new `lib/events/decline-pending.ts` mirrors `lib/events/rematch.ts`: a pure `selectDeclinablePendings` filter plus a `dispatchDeclinePendingForTomorrow` walker over tomorrow's events. A thin cron route drives it. The only orchestrator change is adding a `"cron"` source so the Luma writeback (`source !== "luma"`) fires.

**Tech Stack:** TypeScript, Next.js App Router (route handlers), Vitest, Vercel Cron, Supabase, Notion + Luma APIs.

**Reference spec:** `docs/superpowers/specs/2026-08-19-auto-decline-pending-day-before-design.md`

---

## File Structure

- **Modify** `lib/sync/approval.ts` — add `"cron"` to the `ApprovalSource` union (enables Luma writeback for cron-origin declines).
- **Create** `lib/events/decline-pending.ts` — pure `selectDeclinablePendings` + `declinePendingForEvent` + `dispatchDeclinePendingForTomorrow` + the `ApplyDeps` builder.
- **Create** `app/api/cron/decline-pending/route.ts` — cron-secret-guarded handler that calls the dispatcher and logs a summary.
- **Modify** `vercel.json` — register the cron at `0 13 * * *`.
- **Create** `tests/decline-pending.test.ts` — fixture tests for `selectDeclinablePendings`.
- **Modify** `tests/approval-apply.test.ts` — one test asserting `source: "cron"` triggers the Luma writeback.

Note: unlike the spec's first draft, we do **not** add a `listPendingBookingsForEvent` DB helper — we reuse the existing `listBookingsForEvent(eventId)` and filter in memory with the pure selector, exactly as `rematch.ts` does.

---

## Task 1: Add the `"cron"` approval source

**Files:**
- Modify: `lib/sync/approval.ts:4`
- Test: `tests/approval-apply.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe("applyLumaStatus", …)` block in `tests/approval-apply.test.ts` (after the "Luma-origin change never writes back" test):

```ts
  it("cron-origin decline writes back to Luma + emails declined", async () => {
    const d = deps();
    await applyLumaStatus(booking({ status: "unassigned" }), "declined", { source: "cron" }, d);
    expect(d.sendComms).toHaveBeenCalledWith("b1", "declined");
    expect(d.updateGuestOnLuma).toHaveBeenCalledWith("evt-1", "gst-1", "declined");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/approval-apply.test.ts`
Expected: FAIL — TypeScript error that `"cron"` is not assignable to `ApprovalSource` (`source: "cron"` rejected).

- [ ] **Step 3: Add `"cron"` to the union**

In `lib/sync/approval.ts`, change line 4 from:

```ts
export type ApprovalSource = "luma" | "dev" | "ambassador";
```

to:

```ts
export type ApprovalSource = "luma" | "dev" | "ambassador" | "cron";
```

No other change — the existing `if (opts.source !== "luma")` writeback guard already covers `"cron"`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/approval-apply.test.ts`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 5: Commit**

```bash
git add lib/sync/approval.ts tests/approval-apply.test.ts
git commit -m "feat(approval): add cron approval source for automated declines"
```

---

## Task 2: Pure `selectDeclinablePendings` selector

**Files:**
- Create: `lib/events/decline-pending.ts`
- Test: `tests/decline-pending.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/decline-pending.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { selectDeclinablePendings } from "../lib/events/decline-pending";
import type { Booking } from "../lib/sync/types";

const bk = (over: Partial<Booking>): Booking =>
  ({ id: "b1", luma_status: "pending", status: "unassigned", ...over } as Booking);

describe("selectDeclinablePendings", () => {
  it("selects only pending bookings", () => {
    const rows = [
      bk({ id: "p1", luma_status: "pending" }),
      bk({ id: "p2", luma_status: "pending", status: "no_help_needed" }),
      bk({ id: "a1", luma_status: "approved" }),
      bk({ id: "w1", luma_status: "waitlist" }),
      bk({ id: "d1", luma_status: "declined" }),
    ];
    expect(selectDeclinablePendings(rows).map((b) => b.id)).toEqual(["p1", "p2"]);
  });

  it("returns empty when nothing is pending", () => {
    expect(selectDeclinablePendings([bk({ luma_status: "approved" })])).toEqual([]);
  });

  it("includes pendings regardless of assignment status (all pendings)", () => {
    const rows = [
      bk({ id: "u1", luma_status: "pending", status: "unassigned" }),
      bk({ id: "n1", luma_status: "pending", status: "no_help_needed" }),
    ];
    expect(selectDeclinablePendings(rows).map((b) => b.id)).toEqual(["u1", "n1"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/decline-pending.test.ts`
Expected: FAIL — cannot resolve `../lib/events/decline-pending` (module not created yet).

- [ ] **Step 3: Create the module with the pure selector only**

Create `lib/events/decline-pending.ts`:

```ts
import type { Booking } from "../sync/types";

/**
 * All still-`pending` bookings are declinable the day before the event —
 * regardless of whether they requested a 1:1 (unassigned) or not (no_help_needed).
 * Approved / waitlist / already-declined are left untouched.
 */
export function selectDeclinablePendings(bookings: Booking[]): Booking[] {
  return bookings.filter((b) => b.luma_status === "pending");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/decline-pending.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/events/decline-pending.ts tests/decline-pending.test.ts
git commit -m "feat(decline): pure selectDeclinablePendings + tests"
```

---

## Task 3: Dispatcher + per-event decline + deps

**Files:**
- Modify: `lib/events/decline-pending.ts`

No new unit test: this mirrors `lib/events/rematch.ts`'s `dispatchRematchForTomorrow`, which the codebase deliberately leaves to integration/`sync_log` verification rather than module-mocked tests (the pure selector in Task 2 carries the unit coverage). The deps builder is the same shape proven by `tests/approval-apply.test.ts`.

- [ ] **Step 1: Add the deps builder, per-event decline, and dispatcher**

Replace the entire contents of `lib/events/decline-pending.ts` with:

```ts
import { listBookingsForEvent, setLumaStatus, resetAssignment } from "../db/bookings";
import { listEventsByDate, getEventById } from "../db/events";
import { sendBookingComms } from "../email/comms";
import { pushBookingToWorkspaces } from "../notion/push";
import { updateGuestStatus } from "../luma/client";
import { applyLumaStatus, type ApplyDeps } from "../sync/approval";
import { logSync } from "../sync/log";
import { isoDatePlusDays } from "./prep";
import type { Booking } from "../sync/types";

/**
 * All still-`pending` bookings are declinable the day before the event —
 * regardless of whether they requested a 1:1 (unassigned) or not (no_help_needed).
 * Approved / waitlist / already-declined are left untouched.
 */
export function selectDeclinablePendings(bookings: Booking[]): Booking[] {
  return bookings.filter((b) => b.luma_status === "pending");
}

/** applyLumaStatus deps for a cron-origin decline (same shape as the Notion route). */
function declineDeps(): ApplyDeps {
  return {
    setLumaStatus,
    resetAssignment,
    pushToWorkspaces: (b) => pushBookingToWorkspaces(b),
    updateGuestOnLuma: (eventLumaId, guestLumaId, next) =>
      updateGuestStatus({ eventLumaId, guestLumaId, status: next }),
    sendComms: (bid, kind) => sendBookingComms(bid, kind),
    getEventLumaId: async (eventId) => (await getEventById(eventId))?.luma_event_id ?? null,
    log: async (e) =>
      logSync({ direction: "luma_in", result: e.error ? "error" : "applied", action: e.action, note: e.note }),
  };
}

/** Decline every still-pending booking of one event. Best-effort per booking. */
export async function declinePendingForEvent(eventId: string): Promise<number> {
  const pendings = selectDeclinablePendings(await listBookingsForEvent(eventId));
  const deps = declineDeps();
  let declined = 0;
  for (const b of pendings) {
    try {
      await applyLumaStatus(b, "declined", { source: "cron" }, deps);
      declined++;
    } catch (err) {
      await logSync({
        direction: "luma_in",
        result: "error",
        bookingId: b.id,
        action: "decline_pending_error",
        note: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return declined;
}

/** For every event happening TOMORROW, decline all still-pending guests. */
export async function dispatchDeclinePendingForTomorrow(
  now: Date = new Date(),
): Promise<{ events: number; guests: number }> {
  const target = isoDatePlusDays(now, 1);
  const events = await listEventsByDate(target);
  let guests = 0;
  for (const ev of events) guests += await declinePendingForEvent(ev.id);
  return { events: events.length, guests };
}
```

- [ ] **Step 2: Verify the selector tests still pass and it typechecks**

Run: `npm test -- tests/decline-pending.test.ts && npm run typecheck`
Expected: PASS (3 tests) and no type errors. If `listBookingsForEvent`, `setLumaStatus`, `resetAssignment`, `getEventById`, or `pushBookingToWorkspaces` import paths differ, fix the import to the real export (they are exported from `lib/db/bookings.ts`, `lib/db/events.ts`, and `lib/notion/push.ts` respectively — confirmed against the Notion webhook route's `approvalDeps`).

- [ ] **Step 3: Commit**

```bash
git add lib/events/decline-pending.ts
git commit -m "feat(decline): dispatchDeclinePendingForTomorrow via applyLumaStatus"
```

---

## Task 4: Cron route

**Files:**
- Create: `app/api/cron/decline-pending/route.ts`

- [ ] **Step 1: Create the route (mirrors `app/api/cron/rematch-apology/route.ts`)**

Create `app/api/cron/decline-pending/route.ts`:

```ts
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { dispatchDeclinePendingForTomorrow } from "@/lib/events/decline-pending";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Day-before auto-decline. Vercel Cron calls this daily (ahead of the agenda /
 * prep / rematch crons); for events happening tomorrow, it declines every guest
 * still at luma_status = 'pending' — sending the declined email, writing declined
 * back to Luma (no duplicate email), and mirroring Declined to both Notion DBs.
 */
export async function POST(req: Request) {
  const secret = env.app.cronSecret();
  const provided =
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { events, guests } = await dispatchDeclinePendingForTomorrow();
  if (guests > 0) {
    await logSync({ direction: "luma_in", result: "applied", action: "decline_pending_cron", note: `events=${events} guests=${guests}` });
  }
  return NextResponse.json({ events, guests });
}

// Vercel Cron issues GET by default; accept both.
export const GET = POST;
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/decline-pending/route.ts
git commit -m "feat(decline): day-before decline-pending cron route"
```

---

## Task 5: Register the cron + full verification

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Add the cron entry**

In `vercel.json`, inside the `"crons"` array, add this entry as the FIRST element (it must run before the other day-before crons so declined guests are excluded from them):

```json
    { "path": "/api/cron/decline-pending", "schedule": "0 13 * * *" },
```

The array should begin:

```json
  "crons": [
    { "path": "/api/cron/decline-pending", "schedule": "0 13 * * *" },
    { "path": "/api/cron/no-show", "schedule": "*/5 * * * *" },
```

- [ ] **Step 2: Validate `vercel.json` is well-formed JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('valid json')"`
Expected: `valid json`

- [ ] **Step 3: Run the full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass (existing count + 4 new: 3 selector + 1 cron-source).

- [ ] **Step 4: Commit**

```bash
git add vercel.json
git commit -m "feat(decline): register decline-pending cron (13:00 UTC, runs first)"
```

---

## Self-Review Notes

- **Spec coverage:** audience=all pendings (Task 2 selector filters only on `luma_status`), timing=own cron at 13:00 UTC first (Task 5), Luma writeback with no duplicate (Task 1 `"cron"` source → existing `updateGuestStatus` sends `send_email:false` for declined), reuse `applyLumaStatus` (Task 3), idempotent (selector skips non-pending; email_log dedups), no cap (dispatcher declines all). All covered.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `selectDeclinablePendings`, `declinePendingForEvent`, `dispatchDeclinePendingForTomorrow`, and the `ApplyDeps` shape are used identically across Tasks 2–4; the `ApplyDeps` fields match `lib/sync/approval.ts` and the Notion route's `approvalDeps`.
