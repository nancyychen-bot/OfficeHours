# "Filtered" Triage Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a synced `Filtered` checkbox so the organizer can hide obviously-bad candidates from the Notion bookings DBs (via a per-workspace view filter) without sending any Luma email, fully reversible.

**Architecture:** `filtered` becomes a new boolean column on `bookings` and a new member of `SyncedFields` — so it rides the existing Notion↔hub sync engine exactly like `luma_status`: tick the checkbox on a card in either workspace → webhook writes it to Supabase → push propagates it to the other workspace's card. Two safety gates block a filtered booking from being claimed or emailed. No Luma writeback.

**Tech Stack:** Next.js 15 / TypeScript, Supabase (Postgres), `@notionhq/client` v5 (data-source API), Vitest.

**Reference spec:** `docs/superpowers/specs/2026-08-10-filtered-flag-design.md`

---

## File Structure

**Modified:**
- `supabase/migrations/0040_bookings_filtered.sql` (create) — add column.
- `lib/supabase/types.ts` — hand-patch `bookings` Row/Insert/Update with `filtered`.
- `lib/sync/types.ts` — add `filtered` to `SyncedFields` + `pickSyncedFields`.
- `lib/sync/hash.ts` — include `filtered` in the canonical hash.
- `lib/notion/schema.ts` — `PROP.filtered` + checkbox in `buildBookingsProperties`.
- `lib/notion/mappers.ts` — read/write the checkbox in create, update, and inbound parse.
- `lib/db/bookings.ts` — `claimBooking` guard + `ClaimResult` `filtered` reason.
- `app/api/webhooks/notion/[workspace]/route.ts` — treat `filtered` claim reason like a conflict (revert chip).
- `lib/events/prep.ts` — add `&& !b.filtered`.
- `lib/events/rematch.ts` — add `&& !b.filtered`.
- `scripts/add-filtered-property.ts` (create) + `package.json` script — add the checkbox to both bookings data sources.
- Tests: `tests/hash.test.ts` (extend), `tests/notion-mappers.test.ts` (extend), `tests/prep.test.ts` (extend), `tests/rematch.test.ts` (extend).

**Build order:** data model (T1) → sync plumbing (T2, T3) → safety gates (T4, T5) → rollout tooling (T6) → verify (T7). Migrations applied to the live DB by the controller (CLI isn't authed; types are hand-patched, per existing repo practice).

**Testing note:** `npm test` runs vitest; single file `npx vitest run tests/<file>.test.ts`; `npm run typecheck`.

---

## Task 1: Migration — `bookings.filtered`

**Files:**
- Create: `supabase/migrations/0040_bookings_filtered.sql`
- Modify: `lib/supabase/types.ts`

Do NOT apply the migration or run `npm run gen:types` (Supabase CLI unauthenticated). Create the SQL and hand-patch types; the controller applies the DDL.

- [ ] **Step 1: Write the migration**

```sql
-- 0040_bookings_filtered.sql
-- Organizer triage flag: hide obviously-bad candidates from the Notion bookings
-- DBs (via a per-workspace view filter) without a Luma decline/email. Synced like
-- luma_status; never written back to Luma.
alter table bookings add column if not exists filtered boolean not null default false;
```

- [ ] **Step 2: Hand-patch `lib/supabase/types.ts`**

Find the `bookings` table block. In its `Row`, `Insert`, and `Update` sub-objects add a `filtered` field, keeping the existing alphabetical ordering (it sorts right after `event_id`/before `guest_*` — place it in alphabetical position among the existing keys; exact position doesn't affect correctness). Add:
- `Row`: `filtered: boolean`
- `Insert`: `filtered?: boolean`
- `Update`: `filtered?: boolean`

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0040_bookings_filtered.sql lib/supabase/types.ts
git commit -m "feat(filtered): bookings.filtered column"
```

---

## Task 2: `SyncedFields` + hash include `filtered`

**Files:**
- Modify: `lib/sync/types.ts`, `lib/sync/hash.ts`
- Test: `tests/hash.test.ts`

- [ ] **Step 1: Write the failing test (extend `tests/hash.test.ts`)**

Add this test (import `hashSyncedFields` is already in the file; if not, add `import { hashSyncedFields } from "../lib/sync/hash";`):

```typescript
import { hashSyncedFields } from "../lib/sync/hash";

describe("hashSyncedFields — filtered", () => {
  const base = {
    status: "unassigned" as const,
    luma_status: "pending" as const,
    booked_by_display_name: null,
    booked_by_type: null,
    filtered: false,
  };
  it("changes when filtered flips", () => {
    expect(hashSyncedFields(base)).not.toBe(hashSyncedFields({ ...base, filtered: true }));
  });
  it("is stable for equal states", () => {
    expect(hashSyncedFields(base)).toBe(hashSyncedFields({ ...base }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hash.test.ts`
Expected: FAIL — either a type error on `filtered` or the hash ignores `filtered` (both assertions can't hold until `filtered` is in the hash). Also `npm run typecheck` will fail because `SyncedFields` lacks `filtered`.

- [ ] **Step 3: Add `filtered` to `SyncedFields` in `lib/sync/types.ts`**

Change the interface and picker:

```typescript
export interface SyncedFields {
  status: BookingStatus;
  luma_status: LumaStatus;
  booked_by_display_name: string | null;
  booked_by_type: BookedByType | null;
  filtered: boolean;
}

export function pickSyncedFields(b: Pick<Booking, keyof SyncedFields>): SyncedFields {
  return {
    status: b.status,
    luma_status: b.luma_status,
    booked_by_display_name: b.booked_by_display_name,
    booked_by_type: b.booked_by_type,
    filtered: b.filtered,
  };
}
```

- [ ] **Step 4: Include `filtered` in the hash in `lib/sync/hash.ts`**

In `hashSyncedFields`, add `filtered` to the canonical object:

```typescript
  const canonical = JSON.stringify({
    status: fields.status,
    luma_status: fields.luma_status,
    booked_by_display_name: fields.booked_by_display_name ?? null,
    booked_by_type: fields.booked_by_type ?? null,
    filtered: fields.filtered ?? false,
  });
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run tests/hash.test.ts && npm run typecheck`
Expected: PASS; no type errors. (Type errors elsewhere that construct `SyncedFields` literals are addressed in Task 3.)

- [ ] **Step 6: Commit**

```bash
git add lib/sync/types.ts lib/sync/hash.ts tests/hash.test.ts
git commit -m "feat(filtered): add filtered to SyncedFields + sync hash"
```

---

## Task 3: Notion schema + mappers for the checkbox

**Files:**
- Modify: `lib/notion/schema.ts`, `lib/notion/mappers.ts`
- Test: `tests/notion-mappers.test.ts`

- [ ] **Step 1: Add the property name + schema in `lib/notion/schema.ts`**

In the `PROP` object add (after `requestedSlot`):

```typescript
  filtered: "Filtered",
```

In `buildBookingsProperties`, add a checkbox property (e.g. after `[PROP.requestedSlot]`):

```typescript
    [PROP.filtered]: { checkbox: {} },
```

- [ ] **Step 2: Write the failing mapper test (extend `tests/notion-mappers.test.ts`)**

Add:

```typescript
import {
  bookingToPageProperties,
  syncedFieldsToUpdateProperties,
  pagePropertiesToSyncedFields,
} from "../lib/notion/mappers";
import { PROP } from "../lib/notion/schema";

describe("filtered checkbox mapping", () => {
  it("writes the checkbox on update", () => {
    const props = syncedFieldsToUpdateProperties({
      status: "unassigned", luma_status: "pending",
      booked_by_display_name: null, booked_by_type: null, filtered: true,
    });
    expect((props[PROP.filtered] as { checkbox: boolean }).checkbox).toBe(true);
  });

  it("reads the checkbox inbound (true / false / missing→false)", () => {
    const on = pagePropertiesToSyncedFields({ [PROP.filtered]: { checkbox: true } });
    expect(on.filtered).toBe(true);
    const off = pagePropertiesToSyncedFields({ [PROP.filtered]: { checkbox: false } });
    expect(off.filtered).toBe(false);
    const missing = pagePropertiesToSyncedFields({});
    expect(missing.filtered).toBe(false);
  });

  it("includes the checkbox on initial create", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const booking = { guest_name: "A", filtered: true, status: "unassigned", luma_status: "pending" } as any;
    const props = bookingToPageProperties(booking);
    expect((props[PROP.filtered] as { checkbox: boolean }).checkbox).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/notion-mappers.test.ts`
Expected: FAIL — `filtered` missing on the update props / `pagePropertiesToSyncedFields` returns no `filtered`.

- [ ] **Step 4: Implement the mapper changes in `lib/notion/mappers.ts`**

Add a checkbox reader near `readSelect`/`readRichText`:

```typescript
/** Read a Notion checkbox property's boolean (from a fetched page); missing → false. */
function readCheckbox(prop: unknown): boolean {
  const p = prop as { checkbox?: boolean } | undefined;
  return !!p?.checkbox;
}
```

In `bookingToPageProperties`, add to the `props` object (near `[PROP.requestedSlot]`):

```typescript
    [PROP.filtered]: { checkbox: !!booking.filtered },
```

In `syncedFieldsToUpdateProperties`, add:

```typescript
    [PROP.filtered]: { checkbox: fields.filtered },
```

In `pagePropertiesToSyncedFields`, add to the returned object:

```typescript
    filtered: readCheckbox(properties[PROP.filtered]),
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run tests/notion-mappers.test.ts && npm run typecheck`
Expected: PASS; no type errors (the `SyncedFields` literal in `pagePropertiesToSyncedFields` now includes `filtered`).

- [ ] **Step 6: Commit**

```bash
git add lib/notion/schema.ts lib/notion/mappers.ts tests/notion-mappers.test.ts
git commit -m "feat(filtered): Notion checkbox schema + mappers (create/update/inbound)"
```

---

## Task 4: Block claiming a filtered booking

**Files:**
- Modify: `lib/db/bookings.ts`, `app/api/webhooks/notion/[workspace]/route.ts`

No unit test (the guard is a Postgres conditional UPDATE, exercised end-to-end); verified via typecheck + the existing conflict path. Reasoning is documented inline.

- [ ] **Step 1: Add the `filtered` reason to `ClaimResult` (`lib/db/bookings.ts`)**

The type currently is:

```typescript
export type ClaimResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "already_claimed"; current: Booking };
```

Add a `filtered` variant:

```typescript
export type ClaimResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "already_claimed"; current: Booking }
  | { ok: false; reason: "filtered"; current: Booking };
```

- [ ] **Step 2: Guard the claim UPDATE + return `filtered`**

In `claimBooking`, add `.eq("filtered", false)` to the guarded update, and branch the no-row case on `current.filtered`:

```typescript
  const { data, error } = await supabase
    .from("bookings")
    .update({
      status: "assigned",
      booked_by_display_name: params.displayName,
      booked_by_type: params.bookedByType,
      previously_matched: true,
    })
    .eq("id", params.bookingId)
    .eq("status", "unassigned")
    .eq("filtered", false) // filtered candidates are hidden + not claimable
    .select("*")
    .maybeSingle();
  if (error) throw error;

  if (data) return { ok: true, booking: data };

  const current = await getBookingById(params.bookingId);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.filtered) return { ok: false, reason: "filtered", current };
  return { ok: false, reason: "already_claimed", current };
```

- [ ] **Step 3: Handle the `filtered` reason in the webhook claim path**

In `app/api/webhooks/notion/[workspace]/route.ts`, the claim path already re-pushes canonical state on `!claim.ok`. Update the line that picks `current` so the `filtered` reason reuses `claim.current`, and log a clearer note. Change:

```typescript
      if (!claim.ok) {
        // Lost the race — re-push canonical state to BOTH sides to correct them.
        const current = claim.reason === "already_claimed" ? claim.current : await getBookingById(booking.id);
        if (current) await pushBookingToWorkspaces(current);
        await logSync({ direction, result: "applied", bookingId: booking.id, action: "claim_conflict", note: "already claimed" });
        return NextResponse.json({ received: true, conflict: true });
      }
```

to:

```typescript
      if (!claim.ok) {
        // Lost the race, or the booking is filtered (hidden + not claimable) — re-push
        // canonical state to BOTH sides so the stray Claim chip reverts.
        const current =
          claim.reason === "already_claimed" || claim.reason === "filtered"
            ? claim.current
            : await getBookingById(booking.id);
        if (current) await pushBookingToWorkspaces(current);
        await logSync({
          direction, result: "applied", bookingId: booking.id, action: "claim_conflict",
          note: claim.reason === "filtered" ? "filtered — not claimable" : "already claimed",
        });
        return NextResponse.json({ received: true, conflict: true });
      }
```

- [ ] **Step 4: Verify typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: no type errors; suite green (no existing test asserts the removed literal).

- [ ] **Step 5: Commit**

```bash
git add lib/db/bookings.ts "app/api/webhooks/notion/[workspace]/route.ts"
git commit -m "feat(filtered): block claiming filtered bookings"
```

---

## Task 5: Exclude filtered from prep + rematch comms

**Files:**
- Modify: `lib/events/prep.ts`, `lib/events/rematch.ts`
- Test: `tests/prep.test.ts`, `tests/rematch.test.ts`

- [ ] **Step 1: Write failing tests**

Extend `tests/prep.test.ts`:

```typescript
import { isEligibleForPrep } from "../lib/events/prep";

describe("isEligibleForPrep — filtered", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const approved = { luma_status: "approved", guest_email: "a@x.com", status: "unassigned", filtered: false } as any;
  it("eligible when approved + not filtered", () => {
    expect(isEligibleForPrep(approved)).toBe(true);
  });
  it("excluded when filtered", () => {
    expect(isEligibleForPrep({ ...approved, filtered: true })).toBe(false);
  });
});
```

Extend `tests/rematch.test.ts`:

```typescript
import { isApprovedUnmatched } from "../lib/events/rematch";

describe("isApprovedUnmatched — filtered", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = { luma_status: "approved", requested_slot: "2:00 PM", status: "unassigned", guest_email: "a@x.com", filtered: false } as any;
  it("eligible when approved unmatched + not filtered", () => {
    expect(isApprovedUnmatched(base)).toBe(true);
  });
  it("excluded when filtered", () => {
    expect(isApprovedUnmatched({ ...base, filtered: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/prep.test.ts tests/rematch.test.ts`
Expected: FAIL — the "excluded when filtered" cases return true (guard not present yet).

- [ ] **Step 3: Add the guards**

In `lib/events/prep.ts`:

```typescript
export function isEligibleForPrep(b: Booking): boolean {
  return b.luma_status === "approved" && !b.filtered && !!b.guest_email && b.status !== "cancelled";
}
```

In `lib/events/rematch.ts`:

```typescript
export function isApprovedUnmatched(b: Booking): boolean {
  return (
    b.luma_status === "approved" &&
    !b.filtered &&
    !!b.requested_slot &&
    b.status === "unassigned" &&
    !!b.guest_email
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/prep.test.ts tests/rematch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/events/prep.ts lib/events/rematch.ts tests/prep.test.ts tests/rematch.test.ts
git commit -m "feat(filtered): exclude filtered bookings from prep + rematch"
```

---

## Task 6: Script to add the checkbox to both bookings DBs

**Files:**
- Create: `scripts/add-filtered-property.ts`
- Modify: `package.json`

Do NOT run the script here (it mutates live Notion). Create it and ensure it typechecks; it's part of manual rollout.

- [ ] **Step 1: Create `scripts/add-filtered-property.ts`**

```typescript
// scripts/add-filtered-property.ts
// Run once: add the "Filtered" checkbox property to BOTH bookings data sources
// (Dev + Ambassador). Notion API v2025-09-03: schema lives on the data source, so
// we use dataSources.update (databases.update silently ignores `properties`).
// Usage: npm run setup:filtered
import { Client } from "@notionhq/client";

async function addFiltered(token: string | undefined, dataSourceId: string | undefined, label: string) {
  if (!token || !dataSourceId) {
    console.warn(`skip ${label}: missing token or data source id`);
    return;
  }
  const notion = new Client({ auth: token });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (notion.dataSources.update as any)({
    data_source_id: dataSourceId,
    properties: { "Filtered": { type: "checkbox", checkbox: {} } },
  });
  console.log(`${label}: Filtered checkbox ensured`);
}

async function main() {
  await addFiltered(process.env.NOTION_DEV_TOKEN, process.env.NOTION_DEV_BOOKINGS_DATA_SOURCE_ID, "dev");
  await addFiltered(process.env.NOTION_AMBASSADOR_TOKEN, process.env.NOTION_AMBASSADOR_BOOKINGS_DATA_SOURCE_ID, "ambassador");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add the npm script to `package.json`**

In `scripts`, add:

```json
    "setup:filtered": "tsx --env-file=.env.local scripts/add-filtered-property.ts",
```

- [ ] **Step 3: Verify typecheck + JSON valid**

Run: `npm run typecheck && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'));console.log('valid json')"`
Expected: no type errors; "valid json".

- [ ] **Step 4: Commit**

```bash
git add scripts/add-filtered-property.ts package.json
git commit -m "feat(filtered): one-time script to add the checkbox to both bookings DBs"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass (existing + new hash/mapper/prep/rematch cases); no type errors.

- [ ] **Step 2: Commit any cleanup (if needed)**

```bash
git add -A && git commit -m "chore(filtered): cleanup" # only if there are changes
```

---

## Controller / rollout steps (not code tasks)

1. Apply migration 0040 to the live DB (Supabase MCP `apply_migration`).
2. Run `npm run setup:filtered` to add the `Filtered` checkbox to both bookings DBs.
3. In **each** workspace's experts' browse view, add a filter: **`Filtered` is not checked**.

No env changes. Deploys normally (merge to main).

---

## Self-Review

**Spec coverage:**
- New `bookings.filtered` column → Task 1. ✓
- Synced field + hash → Task 2. ✓
- Notion checkbox schema + create/update/inbound mappers → Task 3. ✓
- Propagation to both workspaces → automatic: `filtered` is now in `SyncedFields`, so the existing webhook apply-and-push path carries it (no new code; covered by Tasks 2–3). ✓
- Block claiming → Task 4. ✓
- Exclude from prep + rematch → Task 5. ✓
- No Luma writeback → inherent: `filtered` is separate from `luma_status`; nothing added calls `updateGuestStatus`. ✓
- Add property to both DBs (script) → Task 6. ✓
- View filter per workspace → rollout step (manual, per design). ✓

**Placeholder scan:** none. The one "position doesn't affect correctness" note (types.ts ordering) is guidance, not a placeholder.

**Type consistency:** `SyncedFields.filtered: boolean` (Task 2) is read/written as `{ checkbox: boolean }` under `PROP.filtered = "Filtered"` (Task 3), picked in `pickSyncedFields`, hashed (Task 2), guarded in `claimBooking` via `.eq("filtered", false)` and the `filtered` `ClaimResult` reason (Task 4), and read as `b.filtered` in prep/rematch (Task 5). Consistent throughout.
