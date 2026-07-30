# Multi-Event / Multi-City Office Hours — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an organizer register any Office Hours Luma event in one command — the hub auto-pulls event details + slot options — while the shared database ignores unrelated events, supports per-event Notion views, and auto-marks no-shows.

**Architecture:** A `registerEventFromLuma` function (CLI now, admin-UI later) fetches the event and its slot dropdown from Luma, then upserts the `events` row and generates `slots` (labels verbatim from Luma, times from start+interval). The Luma webhook ignores events not in the allowlist. Notion bookings gain `Event` + `Event date` properties for per-event filtering. A Vercel Cron flips no-shows 15 min after a slot ends.

**Tech Stack:** Next.js 15 (App Router, route handlers), Supabase (Postgres, service-role), `@notionhq/client` v5, Luma public API, Vitest, TypeScript, tsx.

**Spec:** `docs/superpowers/specs/2026-07-30-multi-event-office-hours-design.md`

**Conventions in this codebase:**
- Tests: Vitest, files in `tests/`, imports via `@/` alias, run `npx vitest run tests/<file>`.
- Pure logic is extracted so it's testable without hitting Supabase/Luma/Notion.
- DB access via `getAdminClient()` (service role). Enums live in `lib/supabase/types.ts`.
- Commit after each task.

---

### Task 1: Add `cancelled` to the `event_status` enum

**Files:**
- Create: `supabase/migrations/0002_event_status_cancelled.sql`
- Modify: `lib/supabase/types.ts` (the `event_status` union + `Constants`)

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/0002_event_status_cancelled.sql`:

```sql
-- Add a 'cancelled' state for events that are called off (slots drop off boards).
alter type event_status add value if not exists 'cancelled';
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool (project `jldgxdaemtdqcfrdzeby`, name `event_status_cancelled`) with the SQL above. (`ADD VALUE` cannot run inside a transaction block with other statements — keep this migration to just that statement.)

- [ ] **Step 3: Update the generated types**

In `lib/supabase/types.ts`, change the `event_status` enum union from:
```ts
      event_status: "planned" | "live" | "completed"
```
to:
```ts
      event_status: "planned" | "live" | "completed" | "cancelled"
```
and in the `Constants` block change:
```ts
      event_status: ["planned", "live", "completed"],
```
to:
```ts
      event_status: ["planned", "live", "completed", "cancelled"],
```

- [ ] **Step 4: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0002_event_status_cancelled.sql lib/supabase/types.ts
git commit -m "feat: add cancelled event_status"
```

---

### Task 2: Luma event fetch + pure slot-option extraction

**Files:**
- Modify: `lib/luma/types.ts` (add event-detail types)
- Create: `lib/luma/client.ts`
- Test: `tests/luma-client.test.ts`

- [ ] **Step 1: Add event-detail types**

Append to `lib/luma/types.ts`:

```ts
/** Luma event-detail types (from GET /v1/event/get). */
export interface LumaRegistrationQuestion {
  id?: string;
  type?: string;
  label?: string;
  options?: unknown[]; // present for dropdown/multi-select questions
}

export interface LumaEventDetail {
  id: string;
  name: string;
  start_at: string;
  end_at?: string;
  timezone?: string;
  registration_questions?: LumaRegistrationQuestion[] | null;
}
```

- [ ] **Step 2: Write the failing test for pure helpers**

Create `tests/luma-client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseLumaEventId, extractSlotOptions } from "@/lib/luma/client";
import type { LumaRegistrationQuestion } from "@/lib/luma/types";

describe("parseLumaEventId", () => {
  it("returns an evt- id unchanged", () => {
    expect(parseLumaEventId("evt-PHUN4WtUCSD9dgi")).toBe("evt-PHUN4WtUCSD9dgi");
  });
  it("extracts an evt- id embedded in a URL/string", () => {
    expect(parseLumaEventId("https://lu.ma/manage/evt-PHUN4WtUCSD9dgi/x")).toBe("evt-PHUN4WtUCSD9dgi");
  });
  it("throws when no evt- id is present", () => {
    expect(() => parseLumaEventId("https://lu.ma/some-slug")).toThrow();
  });
});

describe("extractSlotOptions", () => {
  const slotQ: LumaRegistrationQuestion = {
    id: "q3", label: "Requested time slot for 1:1 help",
    options: ["2:00-2:30 PM", "2:30-3:00 PM", "3:00-3:30 PM"],
  };
  const textQ: LumaRegistrationQuestion = { id: "q1", label: "What company do you work for?" };

  it("returns the ordered labels of the only question with options", () => {
    expect(extractSlotOptions([textQ, slotQ])).toEqual([
      "2:00-2:30 PM", "2:30-3:00 PM", "3:00-3:30 PM",
    ]);
  });
  it("prefers a slot/time-labelled question when several have options", () => {
    const other: LumaRegistrationQuestion = { id: "q9", label: "Dietary preference", options: ["Veg", "Non-veg"] };
    expect(extractSlotOptions([other, slotQ])).toEqual([
      "2:00-2:30 PM", "2:30-3:00 PM", "3:00-3:30 PM",
    ]);
  });
  it("normalizes option objects to their label/name", () => {
    const objQ: LumaRegistrationQuestion = { id: "q3", label: "time slot", options: [{ label: "9:00 AM" }, { name: "9:30 AM" }] };
    expect(extractSlotOptions([objQ])).toEqual(["9:00 AM", "9:30 AM"]);
  });
  it("returns [] when no question has options", () => {
    expect(extractSlotOptions([textQ])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/luma-client.test.ts`
Expected: FAIL — cannot find module `@/lib/luma/client`.

- [ ] **Step 4: Implement `lib/luma/client.ts`**

```ts
import { env } from "../env";
import type { LumaEventDetail, LumaRegistrationQuestion } from "./types";

const BASE = "https://public-api.luma.com";
const SLOT_HINT = /slot|time|session/i;

/** Extract an `evt-…` id from a raw id or a URL/string that contains one. */
export function parseLumaEventId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/evt-[A-Za-z0-9]+/);
  if (match) return match[0];
  throw new Error(`Could not find an evt- id in: ${input}`);
}

function optionLabel(o: unknown): string {
  if (typeof o === "string") return o;
  if (o && typeof o === "object") {
    const r = o as Record<string, unknown>;
    for (const k of ["label", "name", "value", "text"]) {
      if (typeof r[k] === "string") return r[k] as string;
    }
  }
  return String(o);
}

/**
 * Given a Luma event's registration questions, return the ordered option labels
 * of the slot dropdown. Picks the sole question with options, else the one whose
 * label hints slot/time, else the first with options. [] if none.
 */
export function extractSlotOptions(questions: LumaRegistrationQuestion[]): string[] {
  const withOptions = (questions ?? []).filter(
    (q) => Array.isArray(q.options) && q.options.length > 0,
  );
  if (withOptions.length === 0) return [];
  const chosen =
    withOptions.length === 1
      ? withOptions[0]
      : withOptions.find((q) => SLOT_HINT.test(q.label ?? "")) ?? withOptions[0];
  return (chosen.options ?? []).map(optionLabel);
}

/** Fetch full event detail (host-only) incl. registration_questions. */
export async function getLumaEvent(eventId: string): Promise<LumaEventDetail> {
  const res = await fetch(`${BASE}/v1/event/get?api_id=${encodeURIComponent(eventId)}`, {
    headers: { "x-luma-api-key": env.luma.apiKey() },
  });
  if (!res.ok) {
    throw new Error(`Luma getEvent ${eventId} failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { event?: LumaEventDetail } & Partial<LumaEventDetail>;
  const ev = body.event ?? (body as LumaEventDetail);
  if (!ev?.id) throw new Error(`Luma getEvent ${eventId}: unexpected response shape`);
  return ev;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/luma-client.test.ts`
Expected: PASS (7 assertions).

- [ ] **Step 6: Commit**

```bash
git add lib/luma/types.ts lib/luma/client.ts tests/luma-client.test.ts
git commit -m "feat: Luma getEvent + slot-option extraction"
```

---

### Task 3: Pure slot generation from options

**Files:**
- Create: `lib/events/slots-gen.ts`
- Test: `tests/slots-gen.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/slots-gen.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateSlotsFromOptions } from "@/lib/events/slots-gen";

describe("generateSlotsFromOptions", () => {
  it("assigns sequential times to labels in order", () => {
    const slots = generateSlotsFromOptions(
      ["2:00-2:30 PM", "2:30-3:00 PM"],
      "2026-08-26T21:00:00.000Z",
      30,
    );
    expect(slots).toEqual([
      { name: "2:00-2:30 PM", starts_at: "2026-08-26T21:00:00.000Z", ends_at: "2026-08-26T21:30:00.000Z" },
      { name: "2:30-3:00 PM", starts_at: "2026-08-26T21:30:00.000Z", ends_at: "2026-08-26T22:00:00.000Z" },
    ]);
  });

  it("keeps localized labels verbatim", () => {
    const slots = generateSlotsFromOptions(["午後2時〜2時30分"], "2026-08-26T05:00:00.000Z", 30);
    expect(slots[0].name).toBe("午後2時〜2時30分");
    expect(slots[0].ends_at).toBe("2026-08-26T05:30:00.000Z");
  });

  it("honors a custom slot length", () => {
    const slots = generateSlotsFromOptions(["A", "B"], "2026-08-26T21:00:00.000Z", 20);
    expect(slots[1].starts_at).toBe("2026-08-26T21:20:00.000Z");
  });

  it("returns [] for no labels", () => {
    expect(generateSlotsFromOptions([], "2026-08-26T21:00:00.000Z", 30)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/slots-gen.test.ts`
Expected: FAIL — cannot find module `@/lib/events/slots-gen`.

- [ ] **Step 3: Implement `lib/events/slots-gen.ts`**

```ts
export interface GeneratedSlot {
  name: string;
  starts_at: string; // ISO (UTC)
  ends_at: string; // ISO (UTC)
}

/**
 * Generate contiguous, equal-length slots. Labels come verbatim from the Luma
 * dropdown (localization-proof); times are computed from an absolute start
 * instant + fixed length + option order.
 */
export function generateSlotsFromOptions(
  labels: string[],
  startAtISO: string,
  lengthMinutes: number,
): GeneratedSlot[] {
  const startMs = new Date(startAtISO).getTime();
  const lenMs = lengthMinutes * 60_000;
  return labels.map((name, i) => {
    const s = startMs + i * lenMs;
    return {
      name,
      starts_at: new Date(s).toISOString(),
      ends_at: new Date(s + lenMs).toISOString(),
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/slots-gen.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add lib/events/slots-gen.ts tests/slots-gen.test.ts
git commit -m "feat: pure slot generation from options"
```

---

### Task 4: Slot reconciliation + event registration

**Files:**
- Create: `lib/events/reconcile.ts`
- Test: `tests/reconcile.test.ts`
- Modify: `lib/db/events.ts` (add `upsertEvent`)
- Create: `lib/events/register.ts`

- [ ] **Step 1: Write the failing test for pure reconciliation**

Create `tests/reconcile.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { reconcileSlots } from "@/lib/events/reconcile";

const desired = [
  { name: "2:00-2:30 PM", starts_at: "2026-08-26T21:00:00.000Z", ends_at: "2026-08-26T21:30:00.000Z" },
  { name: "2:30-3:00 PM", starts_at: "2026-08-26T21:30:00.000Z", ends_at: "2026-08-26T22:00:00.000Z" },
];

describe("reconcileSlots", () => {
  it("inserts all when none exist", () => {
    const r = reconcileSlots([], desired);
    expect(r.toInsert).toHaveLength(2);
    expect(r.toUpdate).toHaveLength(0);
    expect(r.toDeleteIds).toHaveLength(0);
  });

  it("updates existing by name (carrying the id) and inserts new", () => {
    const existing = [{ id: "s1", name: "2:00-2:30 PM" }];
    const r = reconcileSlots(existing, desired);
    expect(r.toUpdate).toEqual([
      { id: "s1", name: "2:00-2:30 PM", starts_at: "2026-08-26T21:00:00.000Z", ends_at: "2026-08-26T21:30:00.000Z" },
    ]);
    expect(r.toInsert.map((s) => s.name)).toEqual(["2:30-3:00 PM"]);
  });

  it("marks existing-not-desired for deletion", () => {
    const existing = [{ id: "s1", name: "2:00-2:30 PM" }, { id: "s9", name: "OLD SLOT" }];
    const r = reconcileSlots(existing, desired);
    expect(r.toDeleteIds).toEqual(["s9"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reconcile.test.ts`
Expected: FAIL — cannot find module `@/lib/events/reconcile`.

- [ ] **Step 3: Implement `lib/events/reconcile.ts`**

```ts
import type { GeneratedSlot } from "./slots-gen";

export interface ExistingSlot {
  id: string;
  name: string;
}
export interface SlotUpdate extends GeneratedSlot {
  id: string;
}
export interface SlotReconciliation {
  toInsert: GeneratedSlot[];
  toUpdate: SlotUpdate[];
  toDeleteIds: string[];
}

/**
 * Diff existing slots (by name) against the desired set. Matching is by name so
 * a re-run preserves the row (and its bookings) while refreshing times.
 * Callers must filter toDeleteIds to slots WITHOUT a booking before deleting.
 */
export function reconcileSlots(
  existing: ExistingSlot[],
  desired: GeneratedSlot[],
): SlotReconciliation {
  const existingByName = new Map(existing.map((s) => [s.name, s]));
  const desiredNames = new Set(desired.map((s) => s.name));

  const toInsert: GeneratedSlot[] = [];
  const toUpdate: SlotUpdate[] = [];
  for (const slot of desired) {
    const match = existingByName.get(slot.name);
    if (match) toUpdate.push({ id: match.id, ...slot });
    else toInsert.push(slot);
  }
  const toDeleteIds = existing.filter((s) => !desiredNames.has(s.name)).map((s) => s.id);
  return { toInsert, toUpdate, toDeleteIds };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/reconcile.test.ts`
Expected: PASS (3 assertions).

- [ ] **Step 5: Add `upsertEvent` to `lib/db/events.ts`**

Append to `lib/db/events.ts`:

```ts
import type { Enums } from "../supabase/types";

export async function upsertEvent(input: {
  lumaEventId: string;
  name: string;
  city: string;
  eventDate: string; // YYYY-MM-DD
  timezone: string;
  status?: Enums<"event_status">;
}): Promise<EventRow> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("events")
    .upsert(
      {
        luma_event_id: input.lumaEventId,
        name: input.name,
        city: input.city,
        event_date: input.eventDate,
        timezone: input.timezone,
        status: input.status ?? "planned",
      },
      { onConflict: "luma_event_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
```

(Note: `getAdminClient` and `EventRow` are already imported at the top of `lib/db/events.ts`; add only the `Enums` import if not present.)

- [ ] **Step 6: Implement `lib/events/register.ts`**

```ts
import { getLumaEvent, extractSlotOptions, parseLumaEventId } from "../luma/client";
import { generateSlotsFromOptions } from "./slots-gen";
import { reconcileSlots } from "./reconcile";
import { upsertEvent } from "../db/events";
import { getAdminClient } from "../supabase/admin";

export interface RegisterInput {
  lumaEvent: string; // evt- id or URL containing one
  city: string;
  slotStart?: string; // ISO instant for first slot; defaults to event start_at
  slotLengthMinutes?: number; // default 30
}

export interface RegisterResult {
  eventId: string;
  eventName: string;
  inserted: number;
  updated: number;
  deleted: number;
  skippedDeletes: number; // slots that would be removed but have bookings
}

/**
 * Register an Office Hours event from Luma: upsert the event, then generate its
 * slots from the Luma slot dropdown (labels verbatim, times from start+length).
 * Idempotent — safe to re-run when the form changes.
 */
export async function registerEventFromLuma(input: RegisterInput): Promise<RegisterResult> {
  const supabase = getAdminClient();
  const eventId = parseLumaEventId(input.lumaEvent);
  const detail = await getLumaEvent(eventId);

  const timezone = detail.timezone ?? "America/Los_Angeles";
  const eventDate = detail.start_at.slice(0, 10); // YYYY-MM-DD

  const event = await upsertEvent({
    lumaEventId: detail.id,
    name: detail.name,
    city: input.city,
    eventDate,
    timezone,
    status: "planned",
  });

  const labels = extractSlotOptions(detail.registration_questions ?? []);
  const startAt = input.slotStart ?? detail.start_at;
  const desired = generateSlotsFromOptions(labels, startAt, input.slotLengthMinutes ?? 30);

  const { data: existing, error: exErr } = await supabase
    .from("slots")
    .select("id, name")
    .eq("event_id", event.id);
  if (exErr) throw exErr;

  const { data: booked, error: bErr } = await supabase
    .from("bookings")
    .select("slot_id")
    .eq("event_id", event.id)
    .not("slot_id", "is", null);
  if (bErr) throw bErr;
  const bookedSlotIds = new Set((booked ?? []).map((b) => b.slot_id));

  const plan = reconcileSlots(existing ?? [], desired);

  if (plan.toInsert.length) {
    const { error } = await supabase
      .from("slots")
      .insert(plan.toInsert.map((s) => ({ event_id: event.id, ...s })));
    if (error) throw error;
  }
  for (const u of plan.toUpdate) {
    const { error } = await supabase
      .from("slots")
      .update({ starts_at: u.starts_at, ends_at: u.ends_at })
      .eq("id", u.id);
    if (error) throw error;
  }
  const deletable = plan.toDeleteIds.filter((id) => !bookedSlotIds.has(id));
  const skippedDeletes = plan.toDeleteIds.length - deletable.length;
  if (deletable.length) {
    const { error } = await supabase.from("slots").delete().in("id", deletable);
    if (error) throw error;
  }

  return {
    eventId: event.id,
    eventName: event.name,
    inserted: plan.toInsert.length,
    updated: plan.toUpdate.length,
    deleted: deletable.length,
    skippedDeletes,
  };
}
```

- [ ] **Step 7: Verify typecheck + tests pass**

Run: `npx tsc --noEmit && npx vitest run tests/reconcile.test.ts`
Expected: typecheck exit 0; reconcile tests PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/events/reconcile.ts tests/reconcile.test.ts lib/db/events.ts lib/events/register.ts
git commit -m "feat: event registration + idempotent slot reconciliation"
```

---

### Task 5: CLI command `npm run register:event`

**Files:**
- Create: `scripts/register-event.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Implement the CLI**

Create `scripts/register-event.ts`:

```ts
/**
 * Register an Office Hours event from Luma.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/register-event.ts \
 *     --luma <evt-id-or-url> --city SF [--slot-start 2026-08-26T21:00:00Z] [--length 30]
 */
import { registerEventFromLuma } from "../lib/events/register";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const lumaEvent = arg("--luma");
  const city = arg("--city");
  if (!lumaEvent || !city) {
    console.error("Required: --luma <evt-id-or-url> --city <City>");
    process.exit(1);
  }
  const slotStart = arg("--slot-start");
  const length = arg("--length");
  const result = await registerEventFromLuma({
    lumaEvent,
    city,
    slotStart,
    slotLengthMinutes: length ? Number(length) : undefined,
  });
  console.log("Registered:", result.eventName);
  console.log(`  slots — inserted ${result.inserted}, updated ${result.updated}, deleted ${result.deleted}, kept-booked ${result.skippedDeletes}`);
}

main().catch((err) => {
  console.error("register-event failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json` `scripts`, add after `setup:notion`:

```json
    "register:event": "tsx --env-file=.env.local scripts/register-event.ts",
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Manual smoke test (real Luma test event)**

Run: `npm run register:event -- --luma evt-PHUN4WtUCSD9dgi --city SF`
Expected: prints "Registered: Office Hours (Test)" and a slot summary. Then verify in Supabase that `slots` for that event match the Luma form's dropdown (names identical). Re-run the same command; expected: `inserted 0, updated N` (idempotent, no duplicates).

- [ ] **Step 5: Commit**

```bash
git add scripts/register-event.ts package.json
git commit -m "feat: register:event CLI"
```

---

### Task 6: Notion `Event` + `Event date` properties

**Files:**
- Modify: `lib/notion/schema.ts` (`PROP`, `buildBookingsProperties`)
- Modify: `lib/notion/mappers.ts` (`PushOptions`, `bookingToPageProperties`)
- Test: `tests/notion-mappers.test.ts` (add cases)
- One-time: align both existing Notion data sources

- [ ] **Step 1: Add the property names + schema**

In `lib/notion/schema.ts`, add to the `PROP` object (after `location`):

```ts
  event: "Event",
  eventDate: "Event date",
```

And in `buildBookingsProperties(...)`, add (after the `location` entry):

```ts
    [PROP.event]: { rich_text: {} },
    [PROP.eventDate]: { date: {} },
```

- [ ] **Step 2: Write the failing mapper test**

Add to `tests/notion-mappers.test.ts` inside a new describe block:

```ts
import { bookingToPageProperties } from "@/lib/notion/mappers";

describe("bookingToPageProperties event fields", () => {
  const booking = {
    id: "b1", event_id: "e1", slot_id: "s1",
    guest_name: "Guest", guest_email: "g@x.com", guest_phone: null,
    role: null, company: null, challenge: null,
    status: "unassigned", booked_by_display_name: null, booked_by_type: null,
    luma_guest_id: "gst-1", notion_dev_page_id: null, notion_ambassador_page_id: null,
    last_synced_hash: null, last_synced_at: null,
    created_at: "2026-07-30T00:00:00Z", updated_at: "2026-07-30T00:00:00Z",
  } as any;

  it("sets Event name and Event date", () => {
    const props = bookingToPageProperties(booking, {
      eventName: "Office Hours — SF — Aug 2026",
      eventDate: "2026-08-26",
    }) as Record<string, any>;
    expect(props["Event"].rich_text[0].text.content).toBe("Office Hours — SF — Aug 2026");
    expect(props["Event date"].date.start).toBe("2026-08-26");
  });

  it("nulls Event date when absent", () => {
    const props = bookingToPageProperties(booking, {}) as Record<string, any>;
    expect(props["Event date"].date).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/notion-mappers.test.ts`
Expected: FAIL — `props["Event"]` is undefined.

- [ ] **Step 4: Extend `PushOptions` + `bookingToPageProperties`**

In `lib/notion/mappers.ts`, add a date helper near `richText`/`select`:

```ts
const dateProp = (v: string | null | undefined) => ({ date: v ? { start: v } : null });
```

Add to the `PushOptions` interface:

```ts
  /** Event name + date for per-event Notion views. */
  eventName?: string | null;
  eventDate?: string | null;
```

In `bookingToPageProperties`, add to the `props` object (after the `location` line):

```ts
    [PROP.event]: richText(opts.eventName ?? null),
    [PROP.eventDate]: dateProp(opts.eventDate ?? null),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/notion-mappers.test.ts`
Expected: PASS (all existing + 2 new).

- [ ] **Step 6: Align the two existing Notion data sources (one-time)**

The two Bookings databases already exist, so add the new properties to each data source via the Notion API (same pattern as the original alignment). For each, PATCH with the dev/ambassador token:

```bash
# Dev data source
curl -s -X PATCH -H "Authorization: Bearer $NOTION_DEV_TOKEN" -H "Notion-Version: 2025-09-03" -H "Content-Type: application/json" \
  "https://api.notion.com/v1/data_sources/3adb35e6-e67f-80cc-8451-000bc8a49e54" \
  -d '{"properties":{"Event":{"rich_text":{}},"Event date":{"date":{}}}}'
# Ambassador data source
curl -s -X PATCH -H "Authorization: Bearer $NOTION_AMBASSADOR_TOKEN" -H "Notion-Version: 2025-09-03" -H "Content-Type: application/json" \
  "https://api.notion.com/v1/data_sources/3ad3139d-bfef-8080-9ae8-000be6037fb1" \
  -d '{"properties":{"Event":{"rich_text":{}},"Event date":{"date":{}}}}'
```

Expected: each returns JSON containing `"Event"` and `"Event date"` in `properties`. (Tokens are in `.env.local`.)

- [ ] **Step 7: Commit**

```bash
git add lib/notion/schema.ts lib/notion/mappers.ts tests/notion-mappers.test.ts
git commit -m "feat: push Event + Event date to Notion for per-event views"
```

---

### Task 7: Populate Event fields on push + ignore unregistered events

**Files:**
- Modify: `app/api/webhooks/luma/route.ts`

- [ ] **Step 1: Pass event name/date into the push**

In `app/api/webhooks/luma/route.ts`, find the `pushBookingToWorkspaces(booking, {...})` call and update both workspace option objects to include the event name + date (the `event` row is already in scope from `getEventByLumaId`):

```ts
    await pushBookingToWorkspaces(booking, {
      dev: { slotLabel: slot?.name ?? null, location: event.city, eventName: event.name, eventDate: event.event_date },
      ambassador: { slotLabel: slot?.name ?? null, location: event.city, eventName: event.name, eventDate: event.event_date },
    });
```

- [ ] **Step 2: Make unregistered events log as `ignored`, not `error`**

In the same file, find the `if (!event) { ... }` block (the "no matching event" path) and change the log from `result: "error"` to `result: "applied"` with an `ignored` action so unrelated calendar events are quiet:

```ts
    if (!event) {
      await logSync({
        direction: "luma_in",
        result: "applied",
        action: "ignored",
        note: `not a registered Office Hours event (${norm.lumaEventId})`,
      });
      return NextResponse.json({ received: true, ignored: true });
    }
```

(Remove the previous `payload: envelope as never` if present — an ignored event needs no payload dump.)

- [ ] **Step 3: Verify typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: typecheck exit 0; build succeeds, all routes compile.

- [ ] **Step 4: Commit**

```bash
git add app/api/webhooks/luma/route.ts
git commit -m "feat: push event fields; ignore unregistered events quietly"
```

---

### Task 8: No-show grace period

**Files:**
- Create: `lib/sync/noshow.ts` (pure cutoff helper)
- Test: `tests/noshow.test.ts`
- Modify: `lib/db/bookings.ts` (`markNoShowsForEndedSlots`)

- [ ] **Step 1: Write the failing test**

Create `tests/noshow.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { NO_SHOW_GRACE_MINUTES, noShowCutoffISO } from "@/lib/sync/noshow";

describe("noShowCutoffISO", () => {
  it("subtracts the grace period from now", () => {
    const now = new Date("2026-08-26T22:00:00.000Z");
    expect(noShowCutoffISO(now)).toBe("2026-08-26T21:45:00.000Z");
  });
  it("uses a 15-minute default grace", () => {
    expect(NO_SHOW_GRACE_MINUTES).toBe(15);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/noshow.test.ts`
Expected: FAIL — cannot find module `@/lib/sync/noshow`.

- [ ] **Step 3: Implement `lib/sync/noshow.ts`**

```ts
/** Minutes past a slot's end before an un-checked-in booking is a no-show. */
export const NO_SHOW_GRACE_MINUTES = 15;

/** Slots that ended before this cutoff are eligible for the no-show sweep. */
export function noShowCutoffISO(now: Date, graceMinutes = NO_SHOW_GRACE_MINUTES): string {
  return new Date(now.getTime() - graceMinutes * 60_000).toISOString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/noshow.test.ts`
Expected: PASS (2 assertions).

- [ ] **Step 5: Apply the grace in the sweep**

In `lib/db/bookings.ts`, update `markNoShowsForEndedSlots`. Change the imports at the top to include the helper:

```ts
import { noShowCutoffISO } from "../sync/noshow";
```

Replace the ended-slots query line:

```ts
    .lt("ends_at", now.toISOString());
```

with:

```ts
    .lt("ends_at", noShowCutoffISO(now));
```

- [ ] **Step 6: Verify typecheck + all tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: typecheck exit 0; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/sync/noshow.ts tests/noshow.test.ts lib/db/bookings.ts
git commit -m "feat: 15-min grace before no-show"
```

---

### Task 9: Scheduled no-show sweep (Cron endpoint)

**Files:**
- Modify: `lib/env.ts` (add `cronSecret`)
- Modify: `.env.example` (add `CRON_SECRET`)
- Create: `app/api/cron/no-show/route.ts`
- Create: `vercel.json` (cron schedule)

- [ ] **Step 1: Add the cron secret to env access**

In `lib/env.ts`, add inside the `app` object:

```ts
    cronSecret: () => optional("CRON_SECRET"),
```

- [ ] **Step 2: Document the env var**

In `.env.example`, under `# --- App ---`, add:

```
# Shared secret guarding the no-show cron endpoint (also set in Vercel).
CRON_SECRET=
```

- [ ] **Step 3: Implement the cron endpoint**

Create `app/api/cron/no-show/route.ts`:

```ts
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { markNoShowsForEndedSlots } from "@/lib/db/bookings";
import { pushBookingToWorkspaces } from "@/lib/notion/push";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";

/**
 * No-show sweep. Vercel Cron calls this on a schedule; it flips any booking whose
 * slot ended > NO_SHOW_GRACE_MINUTES ago and is not Checked In to No-show, then
 * mirrors the status to Notion. Guarded by a shared secret.
 */
export async function POST(req: Request) {
  const secret = env.app.cronSecret();
  const provided =
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (secret && provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const swept = await markNoShowsForEndedSlots(new Date());
  for (const booking of swept) {
    await pushBookingToWorkspaces(booking);
    await logSync({ direction: "luma_in", result: "applied", bookingId: booking.id, action: "no_show" });
  }
  return NextResponse.json({ swept: swept.length });
}

// Vercel Cron issues GET by default; accept both.
export const GET = POST;
```

- [ ] **Step 4: Add the Vercel Cron schedule**

Create `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/no-show", "schedule": "*/15 * * * *" }
  ]
}
```

(Vercel Cron sends the project's `CRON_SECRET` as `Authorization: Bearer <secret>` automatically when set; the endpoint also accepts `x-cron-secret` for manual runs.)

- [ ] **Step 5: Verify typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: typecheck exit 0; build shows the new `/api/cron/no-show` route.

- [ ] **Step 6: Set the secret in Vercel + deploy**

```bash
printf '%s' "$(openssl rand -hex 16)" | vercel env add CRON_SECRET production
vercel deploy --prod --yes
```

Also add the same value to `.env.local` (`CRON_SECRET=...`) for local runs.

- [ ] **Step 7: Manual verification**

Run (replace `<secret>` with the value you set):
```bash
curl -s -X POST "https://office-hours-three.vercel.app/api/cron/no-show" -H "x-cron-secret: <secret>" -w "\nHTTP %{http_code}\n"
```
Expected: HTTP 200, `{"swept":N}` (N = number of past-slot bookings flipped; 0 if none). A wrong/missing secret returns 401.

- [ ] **Step 8: Commit**

```bash
git add lib/env.ts .env.example app/api/cron/no-show/route.ts vercel.json
git commit -m "feat: scheduled no-show sweep via Vercel Cron"
```

---

## Self-Review

**Spec coverage:**
- §1 registration → Tasks 2–5 ✅
- §2 ignore unregistered → Task 7; per-event Event/Event date props → Task 6 ✅
- §3 cancelled status → Task 1; no-show grace → Task 8; scheduled sweep → Task 9; timezones (event tz stored, slot times absolute) → Task 4 ✅
- Editing/idempotency → Task 4 (reconcileSlots) ✅

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `generateSlotsFromOptions`/`GeneratedSlot` (Task 3) reused in `reconcileSlots` (Task 4) and `register.ts` (Task 4); `PushOptions.eventName/eventDate` (Task 6) consumed in Task 7; `noShowCutoffISO` (Task 8) consumed in `markNoShowsForEndedSlots` and the constant referenced in the cron. `PROP.event`/`PROP.eventDate` defined in Task 6 used by the same task's mapper. Consistent.

**Scope:** single cohesive phase (onboarding + shared-DB hygiene + no-show). Rollup + notifications explicitly deferred.
