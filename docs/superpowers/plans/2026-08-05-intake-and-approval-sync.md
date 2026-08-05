# Full Intake Capture + Notion-Driven Approval Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture all Luma intake fields, land every registrant in Supabase + both Notion DBs, and make a "Luma Status" approval editable from either Notion DB — synced to Supabase, written back to Luma, and mirrored to the other DB.

**Architecture:** Supabase is the source of truth and sole broker (hub-and-spoke). Two independent status axes: `luma_status` (approval) and `status` (assignment). Pure functions (parse, mapping, hash, templates, orchestration) are unit-tested with injected dependencies; webhooks wire them together.

**Tech Stack:** Next.js (App Router, Node runtime), Supabase (Postgres + service-role client), Notion API v2025-09-03 (`@notionhq/client` v5, data sources), Luma public API, Resend, Vitest.

Spec: `docs/superpowers/specs/2026-08-05-intake-and-approval-sync-design.md`

**Conventions:** Run tests with `npm test` (or `npx vitest run <file>`). Commit after each task. New enum value literals (`no_help_needed`) must not be referenced in the same migration that adds them.

---

## Task 1: Supabase migration — luma_status enum, no_help_needed, intake columns

**Files:**
- Create: `supabase/migrations/0009_intake_and_luma_status.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- 0009 — Full intake capture + Luma approval status
-- Adds the approval axis (luma_status), the "no help needed" assignment state,
-- and the new registration-form fields. Requested slot is stored as a text
-- PREFERENCE and is NOT a slot reservation (slot_id still binds only on claim).
-- ============================================================================

-- Approval axis (separate from the assignment `status`).
create type luma_status as enum ('pending', 'approved', 'waitlist', 'declined');

-- New assignment state for guests who did not request 1:1 help.
-- (Safe inside this migration: no statement below references the literal.)
alter type booking_status add value if not exists 'no_help_needed';

alter table bookings
  add column luma_status      luma_status not null default 'pending',
  add column notion_email     text,
  add column notion_plan      text,
  add column experience_level text,
  add column attend_reasons   text,   -- Luma multi-select, comma-joined
  add column requested_slot   text;   -- text preference; NOT a slot_id reservation

create index bookings_luma_status_idx on bookings (luma_status);

-- Recreate the view so its `select b.*` picks up the new columns.
drop view booking_details;
create view booking_details as
  select
    b.*,
    e.city      as location,
    e.name      as event_name,
    e.event_date,
    e.timezone,
    s.name      as slot_name,
    s.starts_at as slot_starts_at,
    s.ends_at   as slot_ends_at
  from bookings b
  join events e on e.id = b.event_id
  left join slots s on s.id = b.slot_id;
```

- [ ] **Step 2: Apply the migration**

Apply against the linked project (either works):
- Supabase CLI: `supabase db push`
- or the Supabase MCP `apply_migration` tool with name `0009_intake_and_luma_status` and the SQL above.

Expected: success; `bookings` has the 6 new columns and `booking_details` resolves.

- [ ] **Step 3: Verify columns exist**

Run (CLI or MCP `execute_sql`):
```sql
select column_name from information_schema.columns
where table_name = 'bookings'
  and column_name in ('luma_status','notion_email','notion_plan','experience_level','attend_reasons','requested_slot');
```
Expected: 6 rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0009_intake_and_luma_status.sql
git commit -m "feat(db): add luma_status, no_help_needed, and intake columns (0009)"
```

---

## Task 2: Regenerate Supabase types

**Files:**
- Modify: `lib/supabase/types.ts` (generated)

- [ ] **Step 1: Regenerate**

Run: `npm run gen:types`
Expected: `lib/supabase/types.ts` updates — `bookings` Row/Insert/Update gain `luma_status`, `notion_email`, `notion_plan`, `experience_level`, `attend_reasons`, `requested_slot`; a new `luma_status` entry appears under `Enums`; `booking_status` union includes `"no_help_needed"`.

- [ ] **Step 2: Verify typecheck still passes**

Run: `npm run typecheck`
Expected: PASS (no usages yet; existing code unaffected).

- [ ] **Step 3: Commit**

```bash
git add lib/supabase/types.ts
git commit -m "chore(types): regenerate supabase types for 0009"
```

---

## Task 3: Sync types — LumaStatus + SyncedFields.luma_status

**Files:**
- Modify: `lib/sync/types.ts`

- [ ] **Step 1: Add the LumaStatus type and extend SyncedFields**

Replace the `SyncedFields` interface and `pickSyncedFields`, and add `LumaStatus`:

```ts
export type LumaStatus = Enums<"luma_status">;

export interface SyncedFields {
  status: BookingStatus;
  luma_status: LumaStatus;
  booked_by_display_name: string | null;
  booked_by_type: BookedByType | null;
}

export function pickSyncedFields(b: Pick<Booking, keyof SyncedFields>): SyncedFields {
  return {
    status: b.status,
    luma_status: b.luma_status,
    booked_by_display_name: b.booked_by_display_name,
    booked_by_type: b.booked_by_type,
  };
}
```

- [ ] **Step 2: Verify typecheck fails where hash/mappers omit luma_status**

Run: `npm run typecheck`
Expected: FAIL in `lib/sync/hash.ts` and `lib/notion/mappers.ts` (SyncedFields now requires `luma_status`). These are fixed in Tasks 4 and 8.

- [ ] **Step 3: Commit**

```bash
git add lib/sync/types.ts
git commit -m "feat(sync): add LumaStatus and luma_status to SyncedFields"
```

---

## Task 4: Loop-prevention hash includes luma_status

**Files:**
- Modify: `lib/sync/hash.ts`
- Test: `tests/sync-hash.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { hashSyncedFields, isEcho } from "@/lib/sync/hash";
import type { SyncedFields } from "@/lib/sync/types";

const base: SyncedFields = {
  status: "unassigned",
  luma_status: "pending",
  booked_by_display_name: null,
  booked_by_type: null,
};

describe("hashSyncedFields", () => {
  it("changes when luma_status changes", () => {
    const a = hashSyncedFields(base);
    const b = hashSyncedFields({ ...base, luma_status: "approved" });
    expect(a).not.toBe(b);
  });
  it("isEcho true only for the identical state", () => {
    const h = hashSyncedFields(base);
    expect(isEcho(base, h)).toBe(true);
    expect(isEcho({ ...base, luma_status: "approved" }, h)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sync-hash.test.ts`
Expected: FAIL — hash ignores `luma_status`, so the two hashes are equal.

- [ ] **Step 3: Include luma_status in the canonical serialization**

In `hashSyncedFields`, update the `canonical` object:

```ts
  const canonical = JSON.stringify({
    status: fields.status,
    luma_status: fields.luma_status,
    booked_by_display_name: fields.booked_by_display_name ?? null,
    booked_by_type: fields.booked_by_type ?? null,
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sync-hash.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/sync/hash.ts tests/sync-hash.test.ts
git commit -m "feat(sync): include luma_status in loop-prevention hash"
```

---

## Task 5: Luma approval mapping (replaces lifecycle.ts)

**Files:**
- Create: `lib/luma/approval.ts`
- Delete: `lib/events/lifecycle.ts`
- Test: `tests/luma-approval.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { approvalStatusToLumaStatus } from "@/lib/luma/approval";

describe("approvalStatusToLumaStatus", () => {
  it("maps known statuses", () => {
    expect(approvalStatusToLumaStatus("approved")).toBe("approved");
    expect(approvalStatusToLumaStatus("declined")).toBe("declined");
    expect(approvalStatusToLumaStatus("waitlist")).toBe("waitlist");
  });
  it("treats pending/invited/unknown/null as pending", () => {
    for (const v of ["pending_approval", "pending", "invited", "", null, undefined, "weird"]) {
      expect(approvalStatusToLumaStatus(v as string | null)).toBe("pending");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/luma-approval.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the mapping**

Create `lib/luma/approval.ts`:

```ts
import type { LumaStatus } from "../sync/types";

/**
 * Map Luma's `approval_status` to the hub's approval axis. Everything that isn't
 * an explicit approved/declined/waitlist is treated as pending (untriaged), so
 * un-triaged signups land in the DB as Pending for Notion-side triage.
 */
export function approvalStatusToLumaStatus(approvalStatus: string | null | undefined): LumaStatus {
  switch (approvalStatus) {
    case "approved":
      return "approved";
    case "declined":
      return "declined";
    case "waitlist":
      return "waitlist";
    default:
      return "pending";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/luma-approval.test.ts`
Expected: PASS

- [ ] **Step 5: Delete the obsolete gate**

Run: `git rm lib/events/lifecycle.ts`
(The Luma webhook's import of `lifecycleAction` is removed in Task 12; typecheck will flag it until then.)

- [ ] **Step 6: Commit**

```bash
git add lib/luma/approval.ts tests/luma-approval.test.ts
git commit -m "feat(luma): approval_status -> luma_status mapping; drop lifecycle gate"
```

---

## Task 6: Intake parsing — new fields + label-pinned mapping

**Files:**
- Modify: `lib/luma/parse.ts`
- Test: `tests/luma-parse.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { normalizeGuest } from "@/lib/luma/parse";
import type { LumaGuestData } from "@/lib/luma/types";

function guest(answers: LumaGuestData["registration_answers"]): LumaGuestData {
  return {
    id: "gst-1",
    user_email: "ada@x.com",
    user_name: "Ada Lovelace",
    approval_status: "pending",
    registration_answers: answers,
    event_tickets: [],
    event: { id: "evt-1" },
  };
}

const ANSWERS = [
  { label: "What company do you work for?", question_id: "q1", question_type: "company", value: { company: "Analytical", job_title: "Engineer" } },
  { label: "What email do you use for Notion?", question_id: "q2", question_type: "text", value: "ada@notion.so" },
  { label: "What type of Notion plan are you on?", question_id: "q3", question_type: "dropdown", value: "Business" },
  { label: "How would you rate your experience level with Notion?", question_id: "q4", question_type: "dropdown", value: "Confident - I know my way around" },
  { label: "Why do you want to come to Build Bar?", question_id: "q5", question_type: "multi-select", value: ["I need 1:1 help", "I want to cowork"] },
  { label: "If you're looking for 1:1 support, what would you need help with building?", question_id: "q6", question_type: "long-text", value: "A CRM" },
  { label: "Requested time slot for 1:1 help (if needed)", question_id: "q7", question_type: "dropdown", value: "2:00–2:30 PM" },
];

describe("normalizeGuest — intake mapping", () => {
  it("pins every field by label", () => {
    const n = normalizeGuest(guest(ANSWERS));
    expect(n.company).toBe("Analytical");
    expect(n.role).toBe("Engineer");
    expect(n.notionEmail).toBe("ada@notion.so");
    expect(n.notionPlan).toBe("Business");
    expect(n.experienceLevel).toBe("Confident - I know my way around");
    expect(n.attendReasons).toBe("I need 1:1 help, I want to cowork");
    expect(n.challenge).toBe("A CRM");
    expect(n.requestedSlot).toBe("2:00–2:30 PM");
  });

  it("leaves requestedSlot null when the slot question is unanswered", () => {
    const n = normalizeGuest(guest(ANSWERS.filter((a) => a.question_id !== "q7")));
    expect(n.requestedSlot).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/luma-parse.test.ts`
Expected: FAIL — `notionEmail`/`notionPlan`/… undefined; slot/challenge mis-mapped by the type heuristic.

- [ ] **Step 3: Rewrite the mapper (label-pinned)**

Replace `NormalizedRegistration`, the `RE` block, and `mapAnswers` in `lib/luma/parse.ts` (keep `answerToString`, `jobTitleFromAnswer`, `displayName`, `isCheckedIn`):

```ts
export interface NormalizedRegistration {
  lumaGuestId: string;
  lumaEventId: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string | null;
  role: string | null;
  company: string | null;
  challenge: string | null;
  notionEmail: string | null;
  notionPlan: string | null;
  experienceLevel: string | null;
  attendReasons: string | null;
  requestedSlot: string | null;
  isCheckedIn: boolean;
  approvalStatus: string | null;
}

// Label pins for the finalized Build Bar form (case-insensitive `.test`).
const LABEL = {
  notionEmail: /email.*notion/i,
  notionPlan: /type of notion plan|notion plan/i,
  experience: /experience level/i,
  reasons: /why.*(come|build bar)/i,
  challenge: /help.*building|need help with/i,
  slot: /requested time slot|time slot/i,
};

function mapAnswers(answers: LumaRegistrationAnswer[]): {
  role: string | null;
  company: string | null;
  challenge: string | null;
  notionEmail: string | null;
  notionPlan: string | null;
  experienceLevel: string | null;
  attendReasons: string | null;
  requestedSlot: string | null;
} {
  const out = {
    role: null as string | null,
    company: null as string | null,
    challenge: null as string | null,
    notionEmail: null as string | null,
    notionPlan: null as string | null,
    experienceLevel: null as string | null,
    attendReasons: null as string | null,
    requestedSlot: null as string | null,
  };

  for (const a of answers) {
    const label = a.label ?? "";
    const type = (a.question_type ?? "").toLowerCase();
    const val = answerToString(a);

    if (type === "company") {
      out.company ??= val;
      out.role ??= jobTitleFromAnswer(a);
      continue;
    }
    if (LABEL.notionEmail.test(label)) { out.notionEmail ??= val; continue; }
    if (LABEL.notionPlan.test(label)) { out.notionPlan ??= val; continue; }
    if (LABEL.experience.test(label)) { out.experienceLevel ??= val; continue; }
    if (LABEL.reasons.test(label)) { out.attendReasons ??= val; continue; }
    if (LABEL.slot.test(label)) { out.requestedSlot ??= val; continue; }
    if (LABEL.challenge.test(label) || type === "long-text") { out.challenge ??= val; continue; }
  }
  return out;
}
```

Then update `normalizeGuest`'s return object to spread the new fields:

```ts
export function normalizeGuest(data: LumaGuestData): NormalizedRegistration {
  const answers = data.registration_answers ?? [];
  const mapped = mapAnswers(answers);
  return {
    lumaGuestId: data.id,
    lumaEventId: data.event.id,
    guestName: displayName(data),
    guestEmail: data.user_email,
    guestPhone: data.phone_number ?? null,
    role: mapped.role,
    company: mapped.company,
    challenge: mapped.challenge,
    notionEmail: mapped.notionEmail,
    notionPlan: mapped.notionPlan,
    experienceLevel: mapped.experienceLevel,
    attendReasons: mapped.attendReasons,
    requestedSlot: mapped.requestedSlot,
    isCheckedIn: isCheckedIn(data),
    approvalStatus: data.approval_status ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/luma-parse.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/luma/parse.ts tests/luma-parse.test.ts
git commit -m "feat(luma): label-pinned intake mapping + new form fields"
```

---

## Task 7: DB access — upsert new fields, initial statuses, setLumaStatus, resetAssignment

**Files:**
- Modify: `lib/db/bookings.ts`

- [ ] **Step 1: Extend `upsertBookingFromLuma` input + row**

Add the new params to the input type:

```ts
export async function upsertBookingFromLuma(input: {
  lumaGuestId: string;
  eventId: string;
  slotId: string | null;
  guestName: string;
  guestEmail: string;
  guestPhone?: string | null;
  role?: string | null;
  company?: string | null;
  challenge?: string | null;
  notionEmail?: string | null;
  notionPlan?: string | null;
  experienceLevel?: string | null;
  attendReasons?: string | null;
  requestedSlot?: string | null;
  lumaStatus: import("../sync/types").LumaStatus;
}): Promise<Booking> {
```

In the `row` object, add the new persisted fields and set create-time defaults for the two status axes. Replace the `row`/`reactivate` block with:

```ts
  const existing = await getBookingByLumaGuestId(input.lumaGuestId);
  const reactivate = existing?.status === "cancelled";
  // Initial assignment status on CREATE only: guests who requested a 1:1 slot
  // need a helper (unassigned); everyone else is "no help needed".
  const initialStatus = input.requestedSlot ? "unassigned" : "no_help_needed";
  const row = {
    luma_guest_id: input.lumaGuestId,
    event_id: input.eventId,
    slot_id: input.slotId,
    guest_name: input.guestName,
    guest_email: input.guestEmail,
    guest_phone: input.guestPhone ?? null,
    role: input.role ?? null,
    company: input.company ?? null,
    challenge: input.challenge ?? null,
    notion_email: input.notionEmail ?? null,
    notion_plan: input.notionPlan ?? null,
    experience_level: input.experienceLevel ?? null,
    attend_reasons: input.attendReasons ?? null,
    requested_slot: input.requestedSlot ?? null,
    luma_status: input.lumaStatus,
    ...(existing
      ? {}
      : { status: initialStatus as "unassigned" | "no_help_needed" }),
    ...(reactivate
      ? {
          status: (input.requestedSlot ? "unassigned" : "no_help_needed") as
            | "unassigned"
            | "no_help_needed",
          booked_by_display_name: null,
          booked_by_type: null,
          booked_by_email: null,
        }
      : {}),
  };
```

Note: on plain updates (`existing` present, not cancelled) we refresh guest fields + `luma_status` but never touch `status` — a claim in progress is preserved.

- [ ] **Step 2: Add `setLumaStatus` and `resetAssignment` helpers**

Append to `lib/db/bookings.ts`:

```ts
/** Update only the approval axis. Returns the updated row. */
export async function setLumaStatus(
  bookingId: string,
  next: import("../sync/types").LumaStatus,
): Promise<Booking | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .update({ luma_status: next })
    .eq("id", bookingId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Reset the assignment axis on an approval downgrade: clear helper + slot and set
 * the assignment status back to open. `toStatus` is 'unassigned' if the guest had
 * requested a slot, else 'no_help_needed'.
 */
export async function resetAssignment(
  bookingId: string,
  toStatus: "unassigned" | "no_help_needed",
): Promise<Booking | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .update({
      status: toStatus,
      slot_id: null,
      booked_by_display_name: null,
      booked_by_type: null,
      booked_by_email: null,
    })
    .eq("id", bookingId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: remaining errors only in files not yet updated (mappers, comms, webhooks). `lib/db/bookings.ts` itself compiles.

- [ ] **Step 4: Commit**

```bash
git add lib/db/bookings.ts
git commit -m "feat(db): persist intake fields, initial statuses, setLumaStatus/resetAssignment"
```

---

## Task 8: Notion schema + mappers — Luma Status, no_help_needed, new fields

**Files:**
- Modify: `lib/notion/schema.ts`
- Modify: `lib/notion/mappers.ts`
- Test: `tests/notion-mappers.test.ts` (extend)

- [ ] **Step 1: Extend `schema.ts`**

Add to `PROP`:
```ts
  lumaStatus: "Luma Status",
  notionEmail: "Notion email",
  notionPlan: "Notion plan",
  experienceLevel: "Experience level",
  reasons: "Reasons",
  requestedSlot: "Requested slot",
```

Add `no_help_needed` to `STATUS_LABEL` (first entry):
```ts
export const STATUS_LABEL = {
  no_help_needed: "No help needed",
  unassigned: "Unassigned",
  assigned: "Assigned",
  checked_in: "Checked In",
  no_show: "No-show",
  cancelled: "Cancelled",
} as const;
```

Add the Luma Status label map:
```ts
export const LUMA_STATUS_LABEL = {
  pending: "Pending",
  approved: "Approved",
  waitlist: "Waitlist",
  declined: "Declined",
} as const;
```

In `buildBookingsProperties`, add these properties (before `lumaGuestId`):
```ts
    [PROP.lumaStatus]: {
      select: {
        options: [
          { name: LUMA_STATUS_LABEL.pending, color: "blue" },
          { name: LUMA_STATUS_LABEL.approved, color: "green" },
          { name: LUMA_STATUS_LABEL.waitlist, color: "yellow" },
          { name: LUMA_STATUS_LABEL.declined, color: "red" },
        ],
      },
    },
    [PROP.notionEmail]: { rich_text: {} },
    [PROP.notionPlan]: {
      select: { options: [
        { name: "Enterprise" }, { name: "Business" }, { name: "Plus" }, { name: "Free" },
      ] },
    },
    [PROP.experienceLevel]: { select: { options: [] } },
    [PROP.reasons]: { multi_select: { options: [
      { name: "I need 1:1 help" }, { name: "I want to cowork" }, { name: "Just checking it out" },
    ] } },
    [PROP.requestedSlot]: { rich_text: {} },
```
Also add `no_help_needed` to the Status select options list (first option):
```ts
          { name: STATUS_LABEL.no_help_needed, color: "red" },
```
(`experience_level` options are seeded empty; Notion auto-creates the exact option on first write. The rebuild script in Task 11 can seed known labels.)

- [ ] **Step 2: Write the failing mapper tests**

Add to `tests/notion-mappers.test.ts`:

```ts
import {
  statusToLabel, labelToStatus, lumaStatusToLabel, labelToLumaStatus,
  bookingToPageProperties, pagePropertiesToSyncedFields,
} from "@/lib/notion/mappers";

describe("luma status + no_help_needed mapping", () => {
  it("round-trips luma status", () => {
    expect(lumaStatusToLabel("waitlist")).toBe("Waitlist");
    expect(labelToLumaStatus("Approved")).toBe("approved");
    expect(labelToLumaStatus("nonsense")).toBeNull();
  });
  it("round-trips no_help_needed", () => {
    expect(statusToLabel("no_help_needed")).toBe("No help needed");
    expect(labelToStatus("No help needed")).toBe("no_help_needed");
  });
  it("reads luma_status back from a page", () => {
    const props = { "Luma Status": { select: { name: "Waitlist" } } };
    expect(pagePropertiesToSyncedFields(props).luma_status).toBe("waitlist");
  });
  it("defaults luma_status to pending when absent", () => {
    expect(pagePropertiesToSyncedFields({}).luma_status).toBe("pending");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/notion-mappers.test.ts`
Expected: FAIL — `lumaStatusToLabel`/`labelToLumaStatus` not exported; `luma_status` missing from synced fields.

- [ ] **Step 4: Update `mappers.ts`**

Import the new label map and add converters:
```ts
import { PROP, STATUS_LABEL, BOOKED_BY_TYPE_LABEL, LUMA_STATUS_LABEL } from "./schema";
import type { /* existing */ LumaStatus } from "../sync/types";

const LUMA_STATUS_FROM_LABEL: Record<string, LumaStatus> = Object.fromEntries(
  Object.entries(LUMA_STATUS_LABEL).map(([k, v]) => [v, k as LumaStatus]),
);
export function lumaStatusToLabel(s: LumaStatus): string { return LUMA_STATUS_LABEL[s]; }
export function labelToLumaStatus(label: string | null | undefined): LumaStatus | null {
  if (!label) return null;
  return LUMA_STATUS_FROM_LABEL[label] ?? null;
}
```

Add a `multiSelect` builder near the other property builders:
```ts
const multiSelect = (csv: string | null | undefined) => ({
  multi_select: csv
    ? csv.split(",").map((s) => s.trim()).filter(Boolean).map((name) => ({ name }))
    : [],
});
```

In `bookingToPageProperties`, add the new fields to the returned `props`:
```ts
    [PROP.lumaStatus]: select(lumaStatusToLabel(booking.luma_status)),
    [PROP.notionEmail]: richText(booking.notion_email),
    [PROP.notionPlan]: select(booking.notion_plan),
    [PROP.experienceLevel]: select(booking.experience_level),
    [PROP.reasons]: multiSelect(booking.attend_reasons),
    [PROP.requestedSlot]: richText(booking.requested_slot),
```

In `syncedFieldsToUpdateProperties`, add Luma Status so status-only updates carry it:
```ts
    [PROP.lumaStatus]: select(lumaStatusToLabel(fields.luma_status)),
```

In `releaseUpdateProperties`, leave Luma Status untouched (release is assignment-only) — no change needed there.

In `pagePropertiesToSyncedFields`, add:
```ts
    luma_status: labelToLumaStatus(readSelect(properties[PROP.lumaStatus])) ?? "pending",
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/notion-mappers.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/notion/schema.ts lib/notion/mappers.ts tests/notion-mappers.test.ts
git commit -m "feat(notion): Luma Status + no_help_needed + intake props in schema/mappers"
```

---

## Task 9: Luma writeback client

**Files:**
- Modify: `lib/luma/client.ts`

- [ ] **Step 1: Add `updateGuestStatus`**

Append to `lib/luma/client.ts`:

```ts
import type { LumaStatus } from "../sync/types";

/**
 * The value Luma's update-guest-status endpoint expects for each hub status.
 * ⚠️ VERIFY the exact spelling against the live endpoint before production
 * (docs.luma.com/reference/post_v1-event-update-guest-status). Adjust here only.
 */
const LUMA_API_STATUS: Record<LumaStatus, string> = {
  approved: "approved",
  declined: "declined",
  waitlist: "waitlist",
  pending: "pending_approval",
};

/**
 * Push an approval decision back to Luma (Notion-originated changes only).
 * Best-effort at the call site: throws on non-2xx so the caller can log it;
 * Luma reconciles via its own webhook on the next guest.updated.
 */
export async function updateGuestStatus(params: {
  eventLumaId: string; // evt-…
  guestLumaId: string; // gst-…
  status: LumaStatus;
}): Promise<void> {
  const res = await fetch(`${BASE}/v1/event/update-guest-status`, {
    method: "POST",
    headers: {
      "x-luma-api-key": env.luma.apiKey(),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      event_api_id: params.eventLumaId,
      guest_api_id: params.guestLumaId,
      status: LUMA_API_STATUS[params.status],
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Luma update-guest-status failed: HTTP ${res.status} ${await res.text().catch(() => "")}`.trim(),
    );
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: `lib/luma/client.ts` compiles.

- [ ] **Step 3: Commit**

```bash
git add lib/luma/client.ts
git commit -m "feat(luma): updateGuestStatus writeback client"
```

---

## Task 10: `applyLumaStatus` orchestrator (+ comms kinds)

**Files:**
- Modify: `lib/email/templates.ts`
- Modify: `lib/email/comms.ts`
- Create: `lib/sync/approval.ts`
- Test: `tests/comms-templates.test.ts` (extend)
- Test: `tests/approval-apply.test.ts` (create)

- [ ] **Step 1: Write failing template tests**

Add to `tests/comms-templates.test.ts` inside `describe("renderComms", ...)`:

```ts
  it("cancelled → guest and helper", () => {
    const g = renderComms("cancelled", "guest", fields())!;
    expect(g.subject.toLowerCase()).toContain("cancelled");
    expect(g.text).toContain("Hi Ada Lovelace,");
    const h = renderComms("cancelled", "helper", fields())!;
    expect(h.subject.toLowerCase()).toContain("released");
  });
  it("expert_unavailable → guest only", () => {
    const g = renderComms("expert_unavailable", "guest", fields())!;
    expect(g.text).toContain("expert is unavailable");
    expect(renderComms("expert_unavailable", "helper", fields())).toBeNull();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/comms-templates.test.ts`
Expected: FAIL — `CommsKind` doesn't include the new kinds; renders return null.

- [ ] **Step 3: Extend templates**

In `lib/email/templates.ts`, widen the kind union:
```ts
export type CommsKind = "assigned" | "checked_in" | "no_show" | "cancelled" | "expert_unavailable";
```

Add these branches to `renderComms` before the final `return null;`:
```ts
  if (kind === "cancelled" && role === "guest") {
    return {
      subject: `Your Notion Build Bar 1:1 booking was cancelled — ${f.guestName}`,
      ...wrap([
        `Hi ${f.guestName},`,
        "",
        "Your 1:1 booking has been cancelled. If this was unexpected, just reply and we'll help.",
        "",
        ...details,
      ]),
    };
  }
  if (kind === "cancelled" && role === "helper") {
    return {
      subject: `Booking released — ${f.guestName}`,
      ...wrap([
        `Hi ${f.helperName ?? "there"},`,
        "",
        "The booking you claimed has been released — no action needed.",
        "",
        ...details,
      ]),
    };
  }
  if (kind === "expert_unavailable" && role === "guest") {
    return {
      subject: `Update on your Notion Build Bar 1:1 — ${f.guestName}`,
      ...wrap([
        `Hi ${f.guestName},`,
        "",
        "Your Notion expert is unavailable. We're finding a replacement for you soon and will confirm shortly.",
        "",
        ...details,
      ]),
    };
  }
```

- [ ] **Step 4: Wire recipients in `comms.ts`**

Add entries to `RECIPIENTS`:
```ts
  cancelled: ["guest", "helper"],
  expert_unavailable: ["guest"],
```

- [ ] **Step 5: Run template tests**

Run: `npx vitest run tests/comms-templates.test.ts`
Expected: PASS

- [ ] **Step 6: Write the failing orchestrator test**

Create `tests/approval-apply.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { applyLumaStatus, type ApplyDeps } from "@/lib/sync/approval";
import type { Booking } from "@/lib/sync/types";

function booking(p: Partial<Booking> = {}): Booking {
  return {
    id: "b1", event_id: "e1", luma_guest_id: "gst-1",
    status: "assigned", luma_status: "pending", requested_slot: "2:00–2:30 PM",
    booked_by_display_name: "Grace", booked_by_type: "employee",
    // remaining columns are irrelevant to this unit; cast for the fixture.
  } as unknown as Booking;
}

function deps(over: Partial<ApplyDeps> = {}): ApplyDeps {
  return {
    setLumaStatus: vi.fn(async (_id, next) => ({ ...booking(), luma_status: next })),
    resetAssignment: vi.fn(async (_id, to) => ({ ...booking(), status: to, slot_id: null, booked_by_display_name: null })),
    pushToWorkspaces: vi.fn(async () => {}),
    updateGuestOnLuma: vi.fn(async () => {}),
    sendComms: vi.fn(async () => {}),
    getEventLumaId: vi.fn(async () => "evt-1"),
    log: vi.fn(async () => {}),
    ...over,
  };
}

describe("applyLumaStatus", () => {
  it("Notion-origin approve: writes back to Luma, no downgrade, pushes", async () => {
    const d = deps();
    await applyLumaStatus(booking({ status: "unassigned" }), "approved", { source: "dev" }, d);
    expect(d.setLumaStatus).toHaveBeenCalledWith("b1", "approved");
    expect(d.updateGuestOnLuma).toHaveBeenCalledWith("evt-1", "gst-1", "approved");
    expect(d.resetAssignment).not.toHaveBeenCalled();
    expect(d.sendComms).not.toHaveBeenCalled();
    expect(d.pushToWorkspaces).toHaveBeenCalled();
  });

  it("Notion-origin decline of an assigned booking: releases + emails cancellation", async () => {
    const d = deps();
    await applyLumaStatus(booking({ status: "assigned", requested_slot: "2:00–2:30 PM" }), "declined", { source: "ambassador" }, d);
    expect(d.resetAssignment).toHaveBeenCalledWith("b1", "unassigned");
    expect(d.sendComms).toHaveBeenCalledWith("b1", "cancelled");
    expect(d.updateGuestOnLuma).toHaveBeenCalledWith("evt-1", "gst-1", "declined");
  });

  it("Luma-origin change never writes back to Luma", async () => {
    const d = deps();
    await applyLumaStatus(booking(), "approved", { source: "luma" }, d);
    expect(d.updateGuestOnLuma).not.toHaveBeenCalled();
  });

  it("downgrade with no requested slot resets to no_help_needed", async () => {
    const d = deps();
    await applyLumaStatus(booking({ status: "assigned", requested_slot: null }), "waitlist", { source: "dev" }, d);
    expect(d.resetAssignment).toHaveBeenCalledWith("b1", "no_help_needed");
  });
});
```

- [ ] **Step 7: Run to verify failure**

Run: `npx vitest run tests/approval-apply.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 8: Implement `lib/sync/approval.ts`**

```ts
import type { Booking, LumaStatus } from "./types";
import type { CommsKind } from "../email/templates";

export type ApprovalSource = "luma" | "dev" | "ambassador";

export interface ApplyDeps {
  setLumaStatus: (bookingId: string, next: LumaStatus) => Promise<Booking | null>;
  resetAssignment: (bookingId: string, to: "unassigned" | "no_help_needed") => Promise<Booking | null>;
  pushToWorkspaces: (booking: Booking) => Promise<unknown>;
  updateGuestOnLuma: (eventLumaId: string, guestLumaId: string, next: LumaStatus) => Promise<void>;
  sendComms: (bookingId: string, kind: CommsKind) => Promise<void>;
  getEventLumaId: (eventId: string) => Promise<string | null>;
  log: (entry: { action: string; note?: string; error?: boolean }) => Promise<void>;
}

/**
 * Apply an approval (luma_status) change from any inbound leg:
 * 1) persist the approval axis; 2) on a downgrade (waitlist/declined) of an
 * ASSIGNED booking, release helper+slot and email both parties; 3) for
 * Notion-originated changes only, write the decision back to Luma; 4) mirror the
 * resulting state to both Notion workspaces. Never throws (best-effort sync).
 */
export async function applyLumaStatus(
  booking: Booking,
  next: LumaStatus,
  opts: { source: ApprovalSource },
  deps: ApplyDeps,
): Promise<void> {
  const wasAssigned = booking.status === "assigned";
  let current = (await deps.setLumaStatus(booking.id, next)) ?? booking;

  const isDowngrade = next === "waitlist" || next === "declined";
  if (isDowngrade && wasAssigned) {
    const to = booking.requested_slot ? "unassigned" : "no_help_needed";
    current = (await deps.resetAssignment(booking.id, to)) ?? current;
    await deps.sendComms(booking.id, "cancelled");
  }

  if (opts.source !== "luma") {
    try {
      const eventLumaId = await deps.getEventLumaId(booking.event_id);
      if (eventLumaId && booking.luma_guest_id) {
        await deps.updateGuestOnLuma(eventLumaId, booking.luma_guest_id, next);
      } else {
        await deps.log({ action: "luma_writeback_skipped", note: "missing event/guest luma id" });
      }
    } catch (err) {
      await deps.log({ action: "luma_writeback_error", note: err instanceof Error ? err.message : String(err), error: true });
    }
  }

  await deps.pushToWorkspaces(current);
}
```

- [ ] **Step 9: Run to verify pass**

Run: `npx vitest run tests/approval-apply.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add lib/email/templates.ts lib/email/comms.ts lib/sync/approval.ts tests/comms-templates.test.ts tests/approval-apply.test.ts
git commit -m "feat(sync): applyLumaStatus orchestrator + cancellation/expert-unavailable emails"
```

---

## Task 11: Notion schema rebuild script (idempotent)

**Files:**
- Create: `scripts/rebuild-notion-schema.ts`
- Modify: `package.json` (add script)

- [ ] **Step 1: Implement the script**

Create `scripts/rebuild-notion-schema.ts`:

```ts
/**
 * Idempotently bring both Bookings data sources up to the current schema:
 * ensures Luma Status, the "No help needed" Status option, and the new intake
 * properties exist. Existing properties/options are preserved (Notion merges).
 *
 * Usage: npx tsx --env-file=.env.local scripts/rebuild-notion-schema.ts
 */
import { getNotionClient, bookingsDataSourceId, type NotionWorkspace } from "../lib/notion/client";
import { PROP, STATUS_LABEL, LUMA_STATUS_LABEL } from "../lib/notion/schema";

const EXPERIENCE_OPTIONS = [
  "Power user - I use advanced features regularly",
  "Confident - I know my way around",
  "Somewhat familiar",
  "New to Notion",
];

async function rebuild(workspace: NotionWorkspace) {
  const notion = getNotionClient(workspace);
  const dsId = bookingsDataSourceId(workspace);
  const properties: Record<string, unknown> = {
    [PROP.lumaStatus]: { select: { options: [
      { name: LUMA_STATUS_LABEL.pending, color: "blue" },
      { name: LUMA_STATUS_LABEL.approved, color: "green" },
      { name: LUMA_STATUS_LABEL.waitlist, color: "yellow" },
      { name: LUMA_STATUS_LABEL.declined, color: "red" },
    ] } },
    [PROP.status]: { select: { options: [
      { name: STATUS_LABEL.no_help_needed, color: "red" },
      { name: STATUS_LABEL.unassigned, color: "gray" },
      { name: STATUS_LABEL.assigned, color: "blue" },
      { name: STATUS_LABEL.checked_in, color: "green" },
      { name: STATUS_LABEL.no_show, color: "red" },
      { name: STATUS_LABEL.cancelled, color: "orange" },
    ] } },
    [PROP.notionEmail]: { rich_text: {} },
    [PROP.notionPlan]: { select: { options: [
      { name: "Enterprise" }, { name: "Business" }, { name: "Plus" }, { name: "Free" },
    ] } },
    [PROP.experienceLevel]: { select: { options: EXPERIENCE_OPTIONS.map((name) => ({ name })) } },
    [PROP.reasons]: { multi_select: { options: [
      { name: "I need 1:1 help" }, { name: "I want to cowork" }, { name: "Just checking it out" },
    ] } },
    [PROP.requestedSlot]: { rich_text: {} },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (notion as any).dataSources.update({ data_source_id: dsId, properties });
  console.log(`[${workspace}] schema updated (Luma Status, No help needed, intake fields).`);
}

async function main() {
  for (const ws of ["dev", "ambassador"] as const) {
    try { await rebuild(ws); }
    catch (err) { console.error(`[${ws}] failed:`, err instanceof Error ? err.message : err); }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Note: `dataSources.update` with a `properties` map that includes existing select options is a merge — it adds missing options/properties without dropping existing ones or data. Setting an existing property to the same type is a no-op.

- [ ] **Step 2: Add npm script**

In `package.json` scripts, add:
```json
    "rebuild:notion": "tsx --env-file=.env.local scripts/rebuild-notion-schema.ts",
```

- [ ] **Step 3: Run it**

Run: `npm run rebuild:notion`
Expected: `[dev] schema updated…` and `[ambassador] schema updated…`.

- [ ] **Step 4: Verify in Notion**

Confirm Ambassador now has a **Luma Status** select (Pending/Approved/Waitlist/Declined), Status includes **No help needed**, and both DBs show the intake fields.

- [ ] **Step 5: Commit**

```bash
git add scripts/rebuild-notion-schema.ts package.json
git commit -m "feat(notion): idempotent schema rebuild script for both workspaces"
```

---

## Task 12: Luma webhook — remove gate, land everyone, push

**Files:**
- Modify: `app/api/webhooks/luma/route.ts`

- [ ] **Step 1: Replace the gate + upsert block**

Remove the `import { lifecycleAction } from "@/lib/events/lifecycle";` line and add:
```ts
import { approvalStatusToLumaStatus } from "@/lib/luma/approval";
```

Delete the `cancel` / `ignore` branches (the whole block from `const action = lifecycleAction(...)` through the end of the `if (action === "ignore")` block). Replace the create section so every registrant upserts:

```ts
    const norm = normalizeGuest(data);

    const event = await getEventByLumaId(norm.lumaEventId);
    if (!event) {
      await logSync({ direction: "luma_in", result: "applied", action: "ignored", note: `not a registered Notion Build Bar event (${norm.lumaEventId})` });
      return NextResponse.json({ received: true, ignored: true });
    }

    // Requested slot is a PREFERENCE (text). We still try to bind a real slot on
    // create for guests who requested one, but a collision just leaves it null
    // (upsertBookingFromLuma retries without the slot) — it binds later on claim.
    const slot = norm.requestedSlot
      ? await matchSlotForEvent({ eventId: event.id, requestedLabel: norm.requestedSlot })
      : null;

    let booking = await upsertBookingFromLuma({
      lumaGuestId: norm.lumaGuestId,
      eventId: event.id,
      slotId: slot?.id ?? null,
      guestName: norm.guestName,
      guestEmail: norm.guestEmail,
      guestPhone: norm.guestPhone,
      role: norm.role,
      company: norm.company,
      challenge: norm.challenge,
      notionEmail: norm.notionEmail,
      notionPlan: norm.notionPlan,
      experienceLevel: norm.experienceLevel,
      attendReasons: norm.attendReasons,
      requestedSlot: norm.requestedSlot,
      lumaStatus: approvalStatusToLumaStatus(norm.approvalStatus),
    });
```

Keep the existing check-in block and the `pushBookingToWorkspaces(booking, { fullUpdate: true, dev: {...}, ambassador: {...} })` call and the final `logSync` unchanged.

- [ ] **Step 2: Typecheck + full test run**

Run: `npm run typecheck && npm test`
Expected: PASS (lifecycle import gone; all suites green).

- [ ] **Step 3: Commit**

```bash
git add app/api/webhooks/luma/route.ts
git commit -m "feat(luma-webhook): land every registrant; set luma_status + intake fields"
```

---

## Task 13: Notion webhook — Luma Status diff, claim auto-approve, unclaim email

**Files:**
- Modify: `app/api/webhooks/notion/[workspace]/route.ts`

- [ ] **Step 1: Add imports**

Add:
```ts
import { setLumaStatus, resetAssignment } from "@/lib/db/bookings";
import { getEventById } from "@/lib/db/events";
import { updateGuestStatus } from "@/lib/luma/client";
import { applyLumaStatus } from "@/lib/sync/approval";
import { pickSyncedFields } from "@/lib/sync/types";
```

Define a small default-deps builder near the top of the module (after imports):
```ts
const approvalDeps = {
  setLumaStatus,
  resetAssignment,
  pushToWorkspaces: (b: import("@/lib/sync/types").Booking) => pushBookingToWorkspaces(b),
  updateGuestOnLuma: (eventLumaId: string, guestLumaId: string, next: import("@/lib/sync/types").LumaStatus) =>
    updateGuestStatus({ eventLumaId, guestLumaId, status: next }),
  sendComms: (bookingId: string, kind: import("@/lib/email/templates").CommsKind) => sendBookingComms(bookingId, kind),
  getEventLumaId: async (eventId: string) => (await getEventById(eventId))?.luma_event_id ?? null,
  log: async (e: { action: string; note?: string; error?: boolean }) =>
    logSync({ direction, result: e.error ? "error" : "applied", action: e.action, note: e.note }),
};
```
(`direction` is in scope inside `POST`; move `approvalDeps` construction to just after `direction` is defined, or inline it where used. Simplest: build it right before use inside the try block.)

- [ ] **Step 2: Add the Luma Status branch after the echo check**

Immediately after the `if (isEcho(incoming, booking.last_synced_hash)) { … }` block, before the claim logic, add:

```ts
    // APPROVAL CHANGE — Luma Status edited in Notion (property-diff, no button).
    if (incoming.luma_status !== booking.luma_status) {
      await applyLumaStatus(booking, incoming.luma_status, { source: workspace }, {
        setLumaStatus,
        resetAssignment,
        pushToWorkspaces: (b) => pushBookingToWorkspaces(b),
        updateGuestOnLuma: (eventLumaId, guestLumaId, next) =>
          updateGuestStatus({ eventLumaId, guestLumaId, status: next }),
        sendComms: (bookingId, kind) => sendBookingComms(bookingId, kind),
        getEventLumaId: async (eventId) => (await getEventById(eventId))?.luma_event_id ?? null,
        log: async (e) => logSync({ direction, result: e.error ? "error" : "applied", bookingId: booking.id, action: e.action, note: e.note }),
      });
      await logSync({ direction, result: "applied", bookingId: booking.id, action: `luma_status:${incoming.luma_status}` });
      return NextResponse.json({ received: true });
    }
```
(Discard the unused `approvalDeps` helper from Step 1 if you inline here — keep only one form.)

- [ ] **Step 3: Claim auto-approval — promote pending on claim**

In the CLAIM branch, after `await pushBookingToWorkspaces(claim.booking);` and before `sendBookingComms(claim.booking.id, "assigned")`, add:

```ts
      // A claim triages an untriaged guest: pending -> approved (writes back to
      // Luma + mirrors). Deliberate waitlist/declined are left untouched.
      if (claim.booking.luma_status === "pending") {
        await applyLumaStatus(claim.booking, "approved", { source: workspace }, {
          setLumaStatus,
          resetAssignment,
          pushToWorkspaces: (b) => pushBookingToWorkspaces(b),
          updateGuestOnLuma: (eventLumaId, guestLumaId, next) =>
            updateGuestStatus({ eventLumaId, guestLumaId, status: next }),
          sendComms: (bookingId, kind) => sendBookingComms(bookingId, kind),
          getEventLumaId: async (eventId) => (await getEventById(eventId))?.luma_event_id ?? null,
          log: async (e) => logSync({ direction, result: e.error ? "error" : "applied", bookingId: booking.id, action: e.action, note: e.note }),
        });
      }
```

- [ ] **Step 4: Unclaim/release email — expert unavailable**

In the **UNCLAIM** branch (the `if (action === "unclaim")` block), after `await clearBookingInWorkspaces(released);`, add:
```ts
      await sendBookingComms(booking.id, "expert_unavailable");
```

In the **RELEASE** branch (`if (booking.status === "assigned" && !claimer)`), after `if (released) await pushBookingToWorkspaces(released);`, add:
```ts
      if (released) await sendBookingComms(released.id, "expert_unavailable");
```

- [ ] **Step 5: Typecheck + full test run**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "app/api/webhooks/notion/[workspace]/route.ts"
git commit -m "feat(notion-webhook): approval sync, claim auto-approve, unclaim email"
```

---

## Task 14: Rollout — Notion automations + Luma verification

**Files:** none (operational).

- [ ] **Step 1: Notion automations (both workspaces)**

In each Bookings DB (Dev + Ambassador), add an automation: **When "Luma Status" is edited → Send webhook** to `<APP_BASE_URL>/api/webhooks/notion/dev` (and `/ambassador` respectively), with header `x-webhook-secret: <that workspace's NOTION_*_WEBHOOK_SECRET>`. (The existing Claim/Unclaim buttons stay as-is.)

- [ ] **Step 2: Verify Luma writeback shape**

Send one real approval from Notion Dev on a test guest and check `sync_log` for `luma_writeback_error`. If Luma rejects the body, adjust `LUMA_API_STATUS` / field names in `lib/luma/client.ts` (Task 9) to match the live endpoint, then redeploy.

- [ ] **Step 3: Confirm Luma event approval mode**

Ensure the Luma event lets guests register so the hub receives `guest.registered` for everyone (approval performed via Notion → Luma writeback, not gated up-front in Luma).

- [ ] **Step 4: End-to-end smoke**

Register a test guest in Luma → row appears in Supabase + both Notion DBs with Luma Status = Pending and Status = (No help needed | Unassigned). Set Approved in Notion → mirrors to the other DB + Luma. Claim a Pending guest → auto-promotes to Approved. Unclaim → guest gets the "expert unavailable" email. Waitlist/Decline an assigned guest → helper released + both emailed.

---

## Self-Review Notes

- **Spec coverage:** intake fields (T6/T7/T8), gate removal (T12), two status axes (T1/T3/T8), Notion-driven approval + Luma writeback + mirror (T9/T10/T13), requested-slot-as-preference + initial status (T7/T12), downgrade release + emails (T10), claim auto-approve (T13), unclaim email (T10/T13), Notion rebuild (T11), rollout (T14). All covered.
- **Type consistency:** `LumaStatus`, `SyncedFields.luma_status`, `applyLumaStatus`/`ApplyDeps`, `setLumaStatus`, `resetAssignment`, `lumaStatusToLabel`/`labelToLumaStatus`, `updateGuestStatus`, `CommsKind` used consistently across tasks.
- **Open risk (carried from spec):** exact Luma `update-guest-status` body/enum spelling — verified operationally in T14/S2; single source of truth is `LUMA_API_STATUS` in `lib/luma/client.ts`.
