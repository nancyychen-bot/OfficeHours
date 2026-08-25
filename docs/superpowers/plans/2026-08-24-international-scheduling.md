# Timezone-Correct Scheduling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the day-based email crons fire on the correct **local** day/hour for events in any timezone (US/EU/Asia), and refuse to register an event with no timezone.

**Architecture:** A pure `lib/events/schedule.ts` provides `isSendDue(now, event, rule)` — "has the event's own local clock reached (event_date + offsetDays) at targetHour, still that local day." Dispatchers fetch a small forward window of events and filter by `isSendDue`; the five affected crons run hourly. `register.ts` throws instead of defaulting a missing timezone to LA.

**Tech Stack:** TypeScript, Vitest, Next.js cron routes, `Intl.DateTimeFormat` (DST-safe), Vercel Cron.

**Reference spec:** `docs/superpowers/specs/2026-08-24-international-scheduling-design.md`

---

## File Structure
- **Modify** `lib/events/register.ts` — throw on missing Luma timezone (Task 1, ships first).
- **Create** `lib/events/schedule.ts` — pure `localNowParts` / `shiftDate` / `isSendDue` (Task 2).
- **Modify** `lib/db/events.ts` — add `listEventsInDateRange` (Task 3).
- **Modify** `lib/events/{prep,decline-pending,rematch,agenda}.ts` — dispatchers use `isSendDue` (Task 3).
- **Modify** `lib/events/recruit-reminder.ts` + `lib/db/bookings.ts` — r2 uses `isSendDue` (Task 4).
- **Modify** `vercel.json` — five crons hourly (Task 5).
- Tests: `tests/schedule.test.ts` (new), `tests/register-timezone.test.ts` (new), update `tests/recruit-reminder.test.ts`.

---

## Task 1: Timezone guard on register (ships first)

**Files:**
- Modify: `lib/events/register.ts`
- Test: `tests/register-timezone.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/register-timezone.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { requireTimezone } from "../lib/events/register";

describe("requireTimezone", () => {
  it("returns the timezone when present", () => {
    expect(requireTimezone("Europe/London", "evt-1")).toBe("Europe/London");
  });
  it("throws when the timezone is missing or blank", () => {
    expect(() => requireTimezone(null, "evt-1")).toThrow(/timezone/i);
    expect(() => requireTimezone(undefined, "evt-1")).toThrow(/timezone/i);
    expect(() => requireTimezone("  ", "evt-1")).toThrow(/timezone/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/register-timezone.test.ts`
Expected: FAIL — `requireTimezone` not exported.

- [ ] **Step 3: Implement + wire in**

In `lib/events/register.ts`, add the exported helper (above `registerEventFromLuma`):
```ts
/** The event's IANA timezone, or throw — never silently default (would corrupt
 * every downstream local-date calc for an international event). */
export function requireTimezone(tz: string | null | undefined, eventId: string): string {
  const t = (tz ?? "").trim();
  if (!t) {
    throw new Error(
      `No timezone for ${eventId}: Luma didn't return an event timezone — set it in Luma and retry.`,
    );
  }
  return t;
}
```
Then replace the fallback line:
```ts
  const timezone = detail.timezone ?? "America/Los_Angeles";
```
with:
```ts
  const timezone = requireTimezone(detail.timezone, detail.id);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/register-timezone.test.ts && npm run typecheck`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add lib/events/register.ts tests/register-timezone.test.ts
git commit -m "feat(i18n): refuse to register an event with no Luma timezone"
```

---

## Task 2: Pure scheduling helper

**Files:**
- Create: `lib/events/schedule.ts`
- Test: `tests/schedule.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/schedule.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { localNowParts, shiftDate, isSendDue } from "../lib/events/schedule";

const at = (iso: string) => new Date(iso);

describe("shiftDate", () => {
  it("shifts calendar days across month/year and DST without drift", () => {
    expect(shiftDate("2026-08-26", -1)).toBe("2026-08-25");
    expect(shiftDate("2026-08-26", -3)).toBe("2026-08-23");
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
    // US spring-forward weekend (DST gap) — still a clean calendar shift:
    expect(shiftDate("2026-03-09", -1)).toBe("2026-03-08");
  });
});

describe("localNowParts", () => {
  it("reports the event-local date + hour", () => {
    // 2026-08-26T02:00Z → Tokyo (+9) is 11:00 on the 26th; London (+1 BST) 03:00.
    expect(localNowParts(at("2026-08-26T02:00:00Z"), "Asia/Tokyo")).toEqual({ date: "2026-08-26", hour: 11 });
    expect(localNowParts(at("2026-08-26T02:00:00Z"), "Europe/London")).toEqual({ date: "2026-08-26", hour: 3 });
    // 2026-08-26T02:00Z → LA (-7 PDT) is 19:00 the PREVIOUS day.
    expect(localNowParts(at("2026-08-26T02:00:00Z"), "America/Los_Angeles")).toEqual({ date: "2026-08-25", hour: 19 });
  });
});

describe("isSendDue", () => {
  const rule = { offsetDays: -1, targetHour: 9 }; // day-before at 9am local
  it("fires at/after 9am local the day before, for each region", () => {
    const tokyo = { event_date: "2026-08-27", timezone: "Asia/Tokyo" };
    // 2026-08-26T00:00Z = 09:00 Tokyo on the 26th (= day before the 27th) → due
    expect(isSendDue(at("2026-08-26T00:00:00Z"), tokyo, rule)).toBe(true);
    // 2026-08-25T23:00Z = 08:00 Tokyo on the 26th → before 9am → not due
    expect(isSendDue(at("2026-08-25T23:00:00Z"), tokyo, rule)).toBe(false);
    const la = { event_date: "2026-08-27", timezone: "America/Los_Angeles" };
    // 2026-08-26T16:00Z = 09:00 LA on the 26th → due
    expect(isSendDue(at("2026-08-26T16:00:00Z"), la, rule)).toBe(true);
  });
  it("self-heals a missed tick later the same local day, but not the next day", () => {
    const london = { event_date: "2026-08-27", timezone: "Europe/London" };
    // 14:00 London on the 26th (missed 9am) → still due
    expect(isSendDue(at("2026-08-26T13:00:00Z"), london, rule)).toBe(true);
    // 09:00 London on the 27th (the event day) → lapsed, NOT due
    expect(isSendDue(at("2026-08-27T08:00:00Z"), london, rule)).toBe(false);
  });
  it("respects a different offset/hour (prep T-3 at 9am, decline at 8am)", () => {
    const ev = { event_date: "2026-08-27", timezone: "America/Los_Angeles" };
    // T-3 rule: due at 9am LA on the 24th
    expect(isSendDue(at("2026-08-24T16:00:00Z"), ev, { offsetDays: -3, targetHour: 9 })).toBe(true);
    // decline rule (8am) is due at 8am LA on the 26th, before the 9am reminder
    expect(isSendDue(at("2026-08-26T15:00:00Z"), ev, { offsetDays: -1, targetHour: 8 })).toBe(true);
    expect(isSendDue(at("2026-08-26T15:00:00Z"), ev, { offsetDays: -1, targetHour: 9 })).toBe(false); // 8am, reminder not yet
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/schedule.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/events/schedule.ts`:
```ts
/** A send rule: fire at (event_date + offsetDays) at targetHour, event-local. */
export interface SendRule {
  offsetDays: number;
  targetHour: number; // 0–23, event-local
}

/** The event-local calendar date (YYYY-MM-DD) and hour (0–23) of an instant. */
export function localNowParts(now: Date, timeZone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  // Some ICU versions emit "24" for midnight under hour12:false.
  const hour = Number(get("hour")) % 24;
  return { date, hour };
}

/** A plain calendar-date shift (YYYY-MM-DD + n days), DST-agnostic (anchors on
 * UTC midnight, so adding whole days never drifts across a DST boundary). */
export function shiftDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/**
 * True when the event's local clock has reached (event_date + offsetDays) at
 * targetHour and it is still that local day. "At or after, same local day" so a
 * missed hourly tick self-heals within the day; the caller's email_log dedup
 * makes the eventual send exactly-once, and the same-day cap keeps e.g. a
 * "day before" send from leaking onto the event day.
 */
export function isSendDue(
  now: Date,
  event: { event_date: string; timezone: string },
  rule: SendRule,
): boolean {
  const target = shiftDate(event.event_date, rule.offsetDays);
  const { date, hour } = localNowParts(now, event.timezone);
  return date === target && hour >= rule.targetHour;
}

/** The UTC date window (inclusive) to fetch when scanning for due events: a safe
 * superset covering every rule's offset (prep is the earliest at −3) plus ±1 for
 * the local/UTC date skew. Callers filter the result with isSendDue. */
export function scanWindow(now: Date): { from: string; to: string } {
  const utcToday = now.toISOString().slice(0, 10);
  return { from: shiftDate(utcToday, -1), to: shiftDate(utcToday, 4) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/schedule.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/events/schedule.ts tests/schedule.test.ts
git commit -m "feat(i18n): pure isSendDue scheduling helper (local day/hour)"
```

---

## Task 3: Range query + refactor the four dispatchers

**Files:**
- Modify: `lib/db/events.ts`, `lib/events/prep.ts`, `lib/events/decline-pending.ts`, `lib/events/rematch.ts`, `lib/events/agenda.ts`

No new unit tests: `isSendDue` (Task 2) carries the scheduling logic; the per-event senders and guest-eligibility predicates are already tested and unchanged.

- [ ] **Step 1: Add `listEventsInDateRange`**

In `lib/db/events.ts`, add after `listEventsByDate`:
```ts
/** Events whose local event_date falls in [fromYmd, toYmd] (inclusive), excluding
 * cancelled. Used by the timezone-aware cron dispatchers, which filter the result
 * per-event with isSendDue. */
export async function listEventsInDateRange(fromYmd: string, toYmd: string): Promise<EventRow[]> {
  const { data, error } = await getAdminClient()
    .from("events")
    .select("*")
    .gte("event_date", fromYmd)
    .lte("event_date", toYmd)
    .neq("status", "cancelled");
  if (error) throw error;
  return data ?? [];
}
```

- [ ] **Step 2: Refactor `prep.ts` dispatchers**

In `lib/events/prep.ts`, add imports:
```ts
import { listEventsInDateRange } from "../db/events";
import { isSendDue, scanWindow } from "./schedule";
```
Replace `sendPrepForLeadWindow`:
```ts
/** Send the T-3 prep email at 9am local, PREP_LEAD_DAYS before each event. */
export async function sendPrepForLeadWindow(now: Date = new Date()): Promise<{ events: number; guests: number }> {
  const { from, to } = scanWindow(now);
  const events = (await listEventsInDateRange(from, to)).filter((e) => isSendDue(now, e, { offsetDays: -PREP_LEAD_DAYS, targetHour: 9 }));
  let guests = 0;
  for (const ev of events) guests += await sendPrepForEvent(ev.id);
  return { events: events.length, guests };
}
```
Replace `sendPrepDayBeforeForLeadWindow`:
```ts
/** Send the Free day-before reminder at 9am local, the day before each event. */
export async function sendPrepDayBeforeForLeadWindow(now: Date = new Date()): Promise<{ events: number; guests: number }> {
  const { from, to } = scanWindow(now);
  const events = (await listEventsInDateRange(from, to)).filter((e) => isSendDue(now, e, { offsetDays: -1, targetHour: 9 }));
  let guests = 0;
  for (const ev of events) guests += await sendPrepDayBeforeForEvent(ev.id);
  return { events: events.length, guests };
}
```
Replace `sendPrepDayBeforePaidForLeadWindow`:
```ts
/** Send the non-Free day-before checklist at 9am local, the day before each event. */
export async function sendPrepDayBeforePaidForLeadWindow(now: Date = new Date()): Promise<{ events: number; guests: number }> {
  const { from, to } = scanWindow(now);
  const events = (await listEventsInDateRange(from, to)).filter((e) => isSendDue(now, e, { offsetDays: -1, targetHour: 9 }));
  let guests = 0;
  for (const ev of events) guests += await sendPrepDayBeforePaidForEvent(ev.id);
  return { events: events.length, guests };
}
```
(Leave `isoDatePlusDays` in the file — still exported/used by tests; it's now unused by these three but harmless.)

- [ ] **Step 3: Refactor `decline-pending.ts`**

In `lib/events/decline-pending.ts`, add imports:
```ts
import { listEventsInDateRange } from "../db/events";
import { isSendDue, scanWindow } from "./schedule";
```
Replace `dispatchDeclinePendingForTomorrow`:
```ts
/** Decline still-pending guests at 8am local, the day before each event (before
 * the 9am reminders, so declines are reflected). */
export async function dispatchDeclinePendingForTomorrow(
  now: Date = new Date(),
): Promise<{ events: number; guests: number }> {
  const { from, to } = scanWindow(now);
  const events = (await listEventsInDateRange(from, to)).filter((e) => isSendDue(now, e, { offsetDays: -1, targetHour: 8 }));
  let guests = 0;
  for (const ev of events) guests += await declinePendingForEvent(ev.id);
  return { events: events.length, guests };
}
```

- [ ] **Step 4: Refactor `rematch.ts`**

In `lib/events/rematch.ts`, add imports:
```ts
import { listEventsInDateRange } from "../db/events";
import { isSendDue, scanWindow } from "./schedule";
```
Replace `dispatchRematchForTomorrow`:
```ts
/** Email still-unmatched approved 1:1 guests at 9am local, the day before each event. */
export async function dispatchRematchForTomorrow(now: Date = new Date()): Promise<{ events: number; guests: number }> {
  const { from, to } = scanWindow(now);
  const events = (await listEventsInDateRange(from, to)).filter((e) => isSendDue(now, e, { offsetDays: -1, targetHour: 9 }));
  let guests = 0;
  for (const ev of events) guests += await sendRematchForEvent(ev.id);
  return { events: events.length, guests };
}
```
(Leave the `listEventsByDate` / `isoDatePlusDays` imports only if still referenced elsewhere in the file; remove the now-unused import to satisfy typecheck if it's the sole use.)

- [ ] **Step 5: Refactor `agenda.ts`**

In `lib/events/agenda.ts`, add imports:
```ts
import { listEventsInDateRange } from "../db/events";
import { isSendDue, scanWindow } from "./schedule";
```
Replace `sendAgendasForToday`:
```ts
/** Send each expert's day-of agenda at 9am local on the event day. */
export async function sendAgendasForToday(now: Date = new Date()): Promise<{ events: number; experts: number }> {
  const { from, to } = scanWindow(now);
  const events = (await listEventsInDateRange(from, to)).filter((e) => isSendDue(now, e, { offsetDays: 0, targetHour: 9 }));
  let experts = 0;
  for (const ev of events) experts += await sendAgendasForEvent(ev.id);
  return { events: events.length, experts };
}
```
(Remove the now-unused `listEventsByDate` import if it was the only use.)

- [ ] **Step 6: Verify typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean (fix any now-unused import it flags); all tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/db/events.ts lib/events/prep.ts lib/events/decline-pending.ts lib/events/rematch.ts lib/events/agenda.ts
git commit -m "feat(i18n): day-based dispatchers fire on local day/hour via isSendDue"
```

---

## Task 4: Recruit reminder r2 (local-aware)

**Files:**
- Modify: `lib/db/bookings.ts` (candidate query), `lib/events/recruit-reminder.ts`
- Test: update `tests/recruit-reminder.test.ts`

- [ ] **Step 1: Add `timezone` to the candidate row + query**

In `lib/db/bookings.ts`, in `listRecruitReminderCandidates`, change the select to also pull the event timezone and map it:
```ts
    .select("id, slack_recruit_posted_at, slack_recruit_r1_at, slack_recruit_r2_at, events!inner(event_date, timezone)")
```
and in the `.map(...)` add:
```ts
    timezone: (Array.isArray(r.events) ? r.events[0]?.timezone : r.events?.timezone) as string,
```

- [ ] **Step 2: Add `timezone` to `RecruitReminderRow` + use isSendDue for r2**

In `lib/events/recruit-reminder.ts`:
- Add `timezone: string;` to the `RecruitReminderRow` interface.
- Import: `import { isSendDue } from "./schedule";`
- The function already builds `const now = new Date(nowMs);`. Replace the r2 branch:
```ts
    if (r.slack_recruit_r2_at == null && todayUtcMs >= dateUtcMs(r.event_date) - r2DaysBeforeEvent * 24 * 60 * 60_000) {
      stages.push("r2");
    }
```
with:
```ts
    if (r.slack_recruit_r2_at == null && isSendDue(now, { event_date: r.event_date, timezone: r.timezone }, { offsetDays: -r2DaysBeforeEvent, targetHour: 9 })) {
      stages.push("r2");
    }
```
(You can delete the now-unused `dateUtcMs` helper and `todayUtcMs` local if nothing else uses them; keep `now` for the r1 branch which still uses `nowMs`/`now`.)

- [ ] **Step 3: Update the r2 tests**

In `tests/recruit-reminder.test.ts`, the r2 fixtures need a `timezone` and now assert local-day behavior. Add `timezone` to the row helper (e.g. default `"America/Los_Angeles"`), and for the r2 due/not-due cases pass a `now` (Date/ms) such that it is / isn't 9am local at `event_date − 2`. Keep the r1 cases unchanged. Example replacement for the r2 boundary case:
```ts
  it("r2 fires at 9am local two days before the event", () => {
    const row = { id: "b", slack_recruit_posted_at: "2026-08-01T00:00:00Z", slack_recruit_r1_at: "2026-08-04T00:00:00Z", slack_recruit_r2_at: null, event_date: "2026-08-27", timezone: "America/Los_Angeles" };
    // 2026-08-25T16:00Z = 09:00 LA on the 25th (= 2 days before the 27th) → r2 due
    const due = selectDueRecruitReminders([row], Date.parse("2026-08-25T16:00:00Z"));
    expect(due).toEqual([{ id: "b", stages: ["r2"] }]);
    // 2026-08-25T15:00Z = 08:00 LA → before 9am → not due
    expect(selectDueRecruitReminders([row], Date.parse("2026-08-25T15:00:00Z"))).toEqual([]);
  });
```
Adjust the other existing r2 assertions similarly (add `timezone`, pick a `nowMs` that lands on/after 9am local of `event_date − 2`).

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test -- tests/recruit-reminder.test.ts`
Expected: clean + pass.

- [ ] **Step 5: Commit**

```bash
git add lib/db/bookings.ts lib/events/recruit-reminder.ts tests/recruit-reminder.test.ts
git commit -m "feat(i18n): recruit r2 fires 9am local two days before the event"
```

---

## Task 5: Crons → hourly

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Change the five schedules to hourly**

In `vercel.json`, set the schedule of these five to `"0 * * * *"` (top of every hour):
`/api/cron/decline-pending`, `/api/cron/recruit-reminder`, `/api/cron/prep-reminder`,
`/api/cron/agenda`, `/api/cron/rematch-apology`. Leave `no-show`, `comms-retry`,
`feedback`, `luma-stats`, `reconcile`, `backup`, `expert-feedback` unchanged.

Result:
```json
    { "path": "/api/cron/decline-pending", "schedule": "0 * * * *" },
    { "path": "/api/cron/no-show", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/comms-retry", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/recruit-reminder", "schedule": "0 * * * *" },
    { "path": "/api/cron/prep-reminder", "schedule": "0 * * * *" },
    { "path": "/api/cron/agenda", "schedule": "0 * * * *" },
    { "path": "/api/cron/rematch-apology", "schedule": "0 * * * *" },
    { "path": "/api/cron/feedback", "schedule": "* * * * *" },
    { "path": "/api/cron/luma-stats", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/reconcile", "schedule": "0 * * * *" },
    { "path": "/api/cron/backup", "schedule": "0 9 * * *" },
    { "path": "/api/cron/expert-feedback", "schedule": "0 * * * *" }
```

- [ ] **Step 2: Validate JSON + full suite/build**

Run: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'));console.log('ok')"` → `ok`
Run: `npm run typecheck && npm test && npm run build`
Expected: clean; all tests pass; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat(i18n): run day-based crons hourly (fire at each event's local hour)"
```

---

## Self-Review Notes
- **Spec coverage:** tz guard first (T1); pure `isSendDue`/`shiftDate`/`localNowParts` + `scanWindow` (T2); range query + prep T-3/day-before(×2)/decline/rematch/agenda dispatchers (T3); recruit r2 (T4); five crons hourly (T5). "Already safe" items (slots, .ics, no-show, feedback-ended, recruit r1) intentionally untouched. All covered.
- **Placeholder scan:** none — full code each step.
- **Type consistency:** `isSendDue(now, {event_date, timezone}, {offsetDays, targetHour})` used identically across T3/T4; `EventRow` has `event_date` + `timezone`; `RecruitReminderRow` gains `timezone`; rules use 9am (8am for decline). `scanWindow` bound (−1..+4) safely supersets the earliest offset (−3).
- **Idempotency:** every affected send is already `email_log`- or stage-stamp-deduped, so hourly re-fires and the same-local-day window are safe.
