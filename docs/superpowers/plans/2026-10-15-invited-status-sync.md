# Invited-Guest Status + Auto-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Represent host-invited Luma guests in the hub as a first-class `invited` status, auto-synced from Luma's guest list on the existing `luma-stats` cron and mirrored to both Notion workspaces — kept out of the active 1:1 pipeline until they accept.

**Architecture:** Add `invited` to the `luma_status` enum and map Luma's `approval_status: "invited"` to it (today it wrongly falls through to `pending`, which the day-before decline sweep would catch). The `luma-stats` cron already pulls each event's full `guests/list` to count it — refactor so it fetches once and also ingests `invited` guests through the existing `normalizeGuest → ingestRegistration({ live:false })` path (which already mirrors to both Notion DBs). A pure change-guard skips steady-state invited guests so the cron never re-pushes hundreds per tick. The now-redundant completion-form email feature is removed.

**Tech Stack:** TypeScript, Supabase (Postgres enum + MCP migrations), Vitest. Reuses `lib/luma/*`, `lib/events/ingest.ts`, `lib/events/luma-stats.ts`, `lib/notion/*`.

**Spec:** `docs/superpowers/specs/2026-10-14-invited-status-sync-design.md`

---

## File structure

- Modify `lib/luma/approval.ts` — map `"invited"` → `luma_status "invited"`.
- Create `supabase/migrations/00NN_luma_status_invited.sql` — add the enum value (also applied via MCP).
- Modify `lib/supabase/types.ts` — regenerated so `LumaStatus` includes `"invited"`.
- Modify `lib/notion/schema.ts` — add `invited: "Invited"` to `LUMA_STATUS_LABEL` + the select option.
- Create `lib/events/invited-sync.ts` — pure `selectInvitedToSync` + `syncInvitedGuestsForEvent`.
- Modify `lib/luma/client.ts` — extract pure `statsFromGuests`; keep `fetchEventStats` wrapping it.
- Modify `lib/events/luma-stats.ts` — fetch guests once; persist stats AND sync invited guests.
- Delete the completion-form feature (see Task 6).
- Tests: `tests/luma-approval.test.ts` (extend), `tests/invited-sync.test.ts` (new), `tests/decline-pending.test.ts` (extend).

---

## Task 1: Add `invited` to the `luma_status` enum + mapping

**Files:**
- Modify: `lib/luma/approval.ts`
- Create: `supabase/migrations/00NN_luma_status_invited.sql`
- Modify: `lib/supabase/types.ts` (regenerated)
- Test: `tests/luma-approval.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/luma-approval.test.ts`:

```typescript
it("maps Luma 'invited' to the invited status (not pending)", () => {
  expect(approvalStatusToLumaStatus("invited")).toBe("invited");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/luma-approval.test.ts`
Expected: FAIL — returns `"pending"` (the default branch), and/or a TS error that `"invited"` isn't a `LumaStatus` yet.

- [ ] **Step 3: Add the enum value in the database**

First get the next migration number: run the Supabase MCP `list_migrations` and use an integer past the remote max (local `supabase/migrations` is a partial mirror — do NOT trust its filenames). Create `supabase/migrations/00NN_luma_status_invited.sql`:

```sql
-- 00NN — add 'invited' to the luma_status enum (host-invited, pre-acceptance guests)
alter type luma_status add value if not exists 'invited';
```

Apply via the Supabase MCP `apply_migration` (name `luma_status_invited`). Note: `ADD VALUE` adds the label only; code using it ships in later steps/deploy.

- [ ] **Step 4: Regenerate Supabase types**

Run the Supabase MCP `generate_typescript_types` and update `lib/supabase/types.ts` so the `luma_status` enum union includes `"invited"`. (Confirm `Enums<"luma_status">` now resolves to `"pending" | "approved" | "waitlist" | "declined" | "invited"`.)

- [ ] **Step 5: Add the mapping case**

In `lib/luma/approval.ts`, add a case to the switch:

```typescript
    case "invited":
      return "invited";
```

(Place it alongside the existing `approved`/`declined`/`waitlist` cases; `default` still returns `"pending"`.)

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/luma-approval.test.ts` then `npx tsc --noEmit`.
Expected: PASS; clean.

- [ ] **Step 7: Commit**

```bash
git add lib/luma/approval.ts lib/supabase/types.ts supabase/migrations/00NN_luma_status_invited.sql tests/luma-approval.test.ts
git commit -m "feat(luma): add 'invited' luma_status for host-invited guests"
```

---

## Task 2: Notion `Invited` status label

**Files:**
- Modify: `lib/notion/schema.ts` (`LUMA_STATUS_LABEL` + the Luma-status select option list)
- Test: `tests/notion-mappers.test.ts` (extend; create if absent)

The mapper helpers (`lumaStatusToLabel` / `labelToLumaStatus` in `lib/notion/mappers.ts`) are derived from `LUMA_STATUS_LABEL`, so adding the label wires both directions automatically.

- [ ] **Step 1: Write the failing test**

Add to `tests/notion-mappers.test.ts`:

```typescript
import { lumaStatusToLabel, labelToLumaStatus } from "@/lib/notion/mappers";

describe("invited luma status label", () => {
  it("round-trips Invited", () => {
    expect(lumaStatusToLabel("invited")).toBe("Invited");
    expect(labelToLumaStatus("Invited")).toBe("invited");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notion-mappers.test.ts -t "Invited"`
Expected: FAIL — `lumaStatusToLabel("invited")` is `undefined` (no label).

- [ ] **Step 3: Add the label + select option**

In `lib/notion/schema.ts`, add to `LUMA_STATUS_LABEL`:

```typescript
  invited: "Invited",
```

and add to the Luma-status select option list (next to the other `LUMA_STATUS_LABEL.*` options):

```typescript
          { name: LUMA_STATUS_LABEL.invited, color: "gray" },
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/notion-mappers.test.ts` then `npx tsc --noEmit`.
Expected: PASS; clean. (`LUMA_STATUS_LABEL` is typed `Record<LumaStatus, string>`, so a missing key fails the build — that's the guard.)

- [ ] **Step 5: Commit**

```bash
git add lib/notion/schema.ts tests/notion-mappers.test.ts
git commit -m "feat(notion): Invited luma-status label + select option"
```

---

## Task 3: Change-guard — `selectInvitedToSync`

**Files:**
- Create: `lib/events/invited-sync.ts`
- Test: `tests/invited-sync.test.ts`

This pure function decides which guest-list entries the cron should ingest, so steady-state invited guests are skipped (bounding the per-tick work) while new invites and accept-transitions are caught.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/invited-sync.test.ts
import { describe, it, expect } from "vitest";
import { selectInvitedToSync } from "@/lib/events/invited-sync";
import type { LumaGuestListEntry } from "@/lib/luma/types";

const g = (id: string, approval: string): LumaGuestListEntry =>
  ({ id, user_email: `${id}@x.com`, approval_status: approval, registration_answers: [] }) as LumaGuestListEntry;

describe("selectInvitedToSync", () => {
  it("ingests a new invited guest with no booking yet", () => {
    const out = selectInvitedToSync([g("a", "invited")], new Map());
    expect(out.map((x) => x.id)).toEqual(["a"]);
  });

  it("skips an invited guest already stored as invited (steady state)", () => {
    const out = selectInvitedToSync([g("a", "invited")], new Map([["a", { luma_status: "invited" }]]));
    expect(out).toEqual([]);
  });

  it("re-ingests an invited booking that has since been accepted (approved)", () => {
    const out = selectInvitedToSync([g("a", "approved")], new Map([["a", { luma_status: "invited" }]]));
    expect(out.map((x) => x.id)).toEqual(["a"]);
  });

  it("ignores guests that are neither now-invited nor stored-invited", () => {
    const out = selectInvitedToSync([g("a", "approved")], new Map([["a", { luma_status: "approved" }]]));
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/invited-sync.test.ts`
Expected: FAIL — `Cannot find module '@/lib/events/invited-sync'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/events/invited-sync.ts
import type { LumaGuestListEntry } from "../luma/types";
import type { Booking } from "../sync/types";
import { approvalStatusToLumaStatus } from "../luma/approval";

/**
 * Which guest-list entries the invited-sync should ingest this tick:
 * - a currently-`invited` guest with no booking yet (new invite), or
 * - a booking still stored `invited` whose Luma status has moved on (accepted).
 * Steady-state invited guests (stored invited, still invited) are skipped so the
 * cron doesn't re-upsert/re-push hundreds every run. Non-invited guests the
 * webhook already handles are ignored.
 */
export function selectInvitedToSync(
  guests: LumaGuestListEntry[],
  bookingsByGuestId: Map<string, Pick<Booking, "luma_status">>,
): LumaGuestListEntry[] {
  return guests.filter((entry) => {
    const current = approvalStatusToLumaStatus(entry.approval_status);
    const existing = bookingsByGuestId.get(entry.id);
    const isInvitedNow = current === "invited";
    const wasInvited = existing?.luma_status === "invited";
    if (!isInvitedNow && !wasInvited) return false; // not our concern
    if (!existing) return isInvitedNow; // brand-new invite
    return existing.luma_status !== current; // transitioned → re-ingest
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/invited-sync.test.ts` then `npx tsc --noEmit`.
Expected: PASS (4 tests); clean.

- [ ] **Step 5: Commit**

```bash
git add lib/events/invited-sync.ts tests/invited-sync.test.ts
git commit -m "feat(events): selectInvitedToSync change-guard"
```

---

## Task 4: Ingest invited guests on the `luma-stats` cron

**Files:**
- Modify: `lib/luma/client.ts` (extract `statsFromGuests`)
- Modify: `lib/events/invited-sync.ts` (add `syncInvitedGuestsForEvent`)
- Modify: `lib/events/luma-stats.ts` (fetch guests once; call the sync)
- Reference: `lib/events/backfill.ts` (the existing ingest loop), `lib/db/bookings.ts` (`listBookingsForEvent`), `lib/events/ingest.ts` (`ingestRegistration`), `lib/luma/parse.ts` (`normalizeGuest`), `lib/luma/types.ts` (`LumaGuestData`, `LumaGuestListEntry`).

- [ ] **Step 1: Extract `statsFromGuests` (no behavior change)**

In `lib/luma/client.ts`, split the counting out of `fetchEventStats` so the guest list can be reused:

```typescript
/** Count buckets from an already-fetched guest list (pure). */
export function statsFromGuests(guests: LumaGuestListEntry[]): LumaEventStats {
  const stats: LumaEventStats = { registered: 0, approved: 0, checkedIn: 0, waitlist: 0, pending: 0, capacity: null };
  for (const g of guests) {
    const st = g.approval_status;
    stats.registered++;
    if (st === "approved") stats.approved++;
    else if (st === "waitlist") stats.waitlist++;
    else if (st === "pending_approval") stats.pending++;
    if ((g.event_tickets ?? []).some((t) => t.checked_in_at)) stats.checkedIn++;
  }
  return stats;
}

/** Authoritative per-event counts straight from Luma's guest list. */
export async function fetchEventStats(eventId: string, apiKey: string): Promise<LumaEventStats> {
  return statsFromGuests(await listEventGuests(eventId, apiKey));
}
```

(Move the existing body of `fetchEventStats` into `statsFromGuests`; keep the `capacity` handling exactly as it was if it differs from the above.)

- [ ] **Step 2: Add `syncInvitedGuestsForEvent`**

Append to `lib/events/invited-sync.ts`:

```typescript
import { normalizeGuest } from "../luma/parse";
import { ingestRegistration } from "./ingest";
import { listBookingsForEvent } from "../db/bookings";
import { logSync } from "../sync/log";
import type { LumaGuestData } from "../luma/types";

/**
 * Ingest the event's host-invited guests from an already-fetched guest list,
 * silently (no emails) and mirrored to both Notion DBs by ingestRegistration.
 * Idempotent via the change-guard; best-effort per guest.
 */
export async function syncInvitedGuestsForEvent(
  eventId: string,
  lumaEventId: string,
  guests: LumaGuestListEntry[],
): Promise<{ synced: number; failed: number }> {
  const bookings = await listBookingsForEvent(eventId);
  const byGuestId = new Map(
    bookings.filter((b) => b.luma_guest_id).map((b) => [b.luma_guest_id as string, { luma_status: b.luma_status }]),
  );
  const toSync = selectInvitedToSync(guests, byGuestId);
  let synced = 0;
  let failed = 0;
  for (const g of toSync) {
    try {
      const norm = normalizeGuest({ ...g, event: { id: lumaEventId } } as LumaGuestData);
      const outcome = await ingestRegistration(norm, { live: false });
      if (outcome.status === "ingested") synced++;
    } catch (err) {
      failed++;
      await logSync({
        direction: "luma_in",
        result: "error",
        action: "invited_sync",
        note: `guest ${g.id}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  if (synced || failed) {
    await logSync({
      direction: "luma_in",
      result: "applied",
      action: "invited_sync",
      note: `${lumaEventId}: ${synced} invited synced, ${failed} failed, ${toSync.length} candidate(s)`,
    });
  }
  return { synced, failed };
}
```

Add the `LumaGuestListEntry` import to the top of the file (extend the existing `../luma/types` import).

- [ ] **Step 3: Wire it into `syncLumaStatsForEvent`**

In `lib/events/luma-stats.ts`, change `syncLumaStatsForEvent` to fetch the guest list once and do both jobs:

```typescript
import { listEventGuests, statsFromGuests } from "../luma/client";
import { syncInvitedGuestsForEvent } from "./invited-sync";

export async function syncLumaStatsForEvent(eventId: string, lumaEventId: string, apiKey: string): Promise<boolean> {
  try {
    const guests = await listEventGuests(lumaEventId, apiKey);
    const stats = statsFromGuests(guests);
    const supabase = getAdminClient();
    const { error } = await supabase
      .from("events")
      .update({ luma_stats: stats as unknown as Record<string, number | null>, luma_synced_at: new Date().toISOString() })
      .eq("id", eventId);
    if (error) throw error;
    // Pull host-invited guests into the hub (silent; mirrored to Notion).
    await syncInvitedGuestsForEvent(eventId, lumaEventId, guests);
    return true;
  } catch (err) {
    await logSync({
      direction: "luma_in",
      result: "error",
      action: "luma_stats_sync",
      note: `${lumaEventId}: ${err instanceof Error ? err.message : String(err)}`,
    });
    return false;
  }
}
```

(Replace the old `fetchEventStats(lumaEventId, apiKey)` call; keep the rest of the file — `selectStatsSyncBatch`, `syncAllLumaStats` — unchanged.)

- [ ] **Step 4: Run the full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`.
Expected: all PASS; clean. (Existing `fetchEventStats` callers still work via the wrapper.)

- [ ] **Step 5: Commit**

```bash
git add lib/luma/client.ts lib/events/invited-sync.ts lib/events/luma-stats.ts
git commit -m "feat(cron): sync host-invited guests into the hub on luma-stats"
```

---

## Task 5: Protect the decline sweep (regression test)

**Files:**
- Test: `tests/decline-pending.test.ts` (extend)
- Reference: `lib/events/decline-pending.ts` (`selectDeclinablePendings` keys on `luma_status === "pending"`)

No code change is expected — `invited` is a distinct status, so the pending-only sweep already excludes it. Lock that in.

- [ ] **Step 1: Write the test**

Add to `tests/decline-pending.test.ts` (match the existing booking-fixture shape in that file):

```typescript
it("never declines an invited guest (only pending)", () => {
  const invited = { ...baseBooking, luma_status: "invited", status: "no_help_needed" };
  expect(selectDeclinablePendings([invited])).toEqual([]);
});
```

(Use the file's existing fixture/helper for `baseBooking`; if it builds bookings inline, mirror that shape with `luma_status: "invited"`.)

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/decline-pending.test.ts`
Expected: PASS immediately (confirms the guard). If it FAILS, `selectDeclinablePendings` keys on something other than `luma_status === "pending"` — fix it to exclude `invited`.

- [ ] **Step 3: Commit**

```bash
git add tests/decline-pending.test.ts
git commit -m "test(decline): invited guests are never auto-declined"
```

---

## Task 6: Remove the completion-form feature

The accept-flow already presents the registration form, so the invited-guest *completion email* is redundant (spec §7). Remove it and repurpose the branch.

**Files:**
- Delete: `app/complete-registration/[token]/page.tsx`, `app/complete-registration/[token]/form.tsx`
- Delete: `app/api/complete-registration/load/route.ts`, `app/api/complete-registration/submit/route.ts`, `app/api/complete-registration/submit/build.ts`
- Delete: `lib/auth/booking-token.ts`, `tests/booking-token.test.ts`
- Delete: `lib/events/invited.ts`, `tests/invited-guest.test.ts`, `tests/complete-registration-submit.test.ts`
- Delete: `scripts/test-completion-flow.ts`, `scripts/test-completion-teardown.ts`
- Modify: `lib/events/ingest.ts` (remove the `shouldSendCompletion` block + its imports)
- Modify: `lib/email/templates.ts` (remove `complete_registration` from `CommsKind`/`TemplateKey`, its `TEMPLATE_REGISTRY` entry, `completionLink` from `CommsFields` + `buildVars` + `PLACEHOLDERS`)
- Modify: `lib/email/comms.ts` (remove the `complete_registration` `RECIPIENTS` entry + the `completionLink` minting in `defaultDeps.getFields`)
- Modify: `middleware.ts` (remove `complete-registration` from the matcher allowlist)
- Keep: `scripts/preview-comms.ts` (generally useful)
- Keep: migration `0059` (already applied to prod; an unused kind is harmless — removing it would need another migration)

- [ ] **Step 1: Delete the files**

```bash
git rm -r "app/complete-registration" "app/api/complete-registration"
git rm lib/auth/booking-token.ts tests/booking-token.test.ts lib/events/invited.ts tests/invited-guest.test.ts tests/complete-registration-submit.test.ts scripts/test-completion-flow.ts scripts/test-completion-teardown.ts
```

- [ ] **Step 2: Unwire `ingest.ts`**

In `lib/events/ingest.ts`, delete the block:

```typescript
  if (shouldSendCompletion({ invited: isInvitedGuest(norm), lumaStatus: nextLumaStatus, live: opts.live })) {
    await sendBookingComms(booking.id, "complete_registration");
  }
```

and remove its import line `import { isInvitedGuest, shouldSendCompletion } from "./invited";`. (Leave the `sendBookingComms` import — it's still used elsewhere in the file.)

- [ ] **Step 3: Unwire the comms kind**

In `lib/email/templates.ts`: remove `| "complete_registration"` from `CommsKind`, `| "complete_registration__guest"` from `TemplateKey`, the `complete_registration__guest` entry in `TEMPLATE_REGISTRY`, the `completionLink?` field on `CommsFields`, and the `completionLink`/`eventName` lines added for it in `buildVars` + `PLACEHOLDERS` (keep `eventName` if another template uses it — grep `{{eventName}}` first; remove only if unused).

In `lib/email/comms.ts`: remove the `complete_registration: ["guest"],` line from `RECIPIENTS`, and the `try { ... issueBookingToken ... f.completionLink = ... }` block in `defaultDeps.getFields`.

- [ ] **Step 4: Un-allowlist the route**

In `middleware.ts`, change the matcher back to drop `complete-registration`:

```typescript
  matcher: ["/((?!login|add-event|change-slot|embed|api|_next/static|_next/image|favicon.ico).*)"],
```

- [ ] **Step 5: Typecheck + full suite**

Run: `npx tsc --noEmit` then `npx vitest run`.
Expected: clean; all PASS. (The `RECIPIENTS` map is `Record<CommsKind, …>` and `TEMPLATE_REGISTRY` is `Record<TemplateKey, …>`, so any dangling reference fails the build — fix until green.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove redundant completion-form feature (accept flow shows the form)"
```

---

## Task 7: Full verification + ship

- [ ] **Step 1: Full suite + typecheck + build**

Run: `npx vitest run`, `npx tsc --noEmit`, `npm run build`.
Expected: all green; build emits (no `/complete-registration` routes anymore).

- [ ] **Step 2: Operator steps (Notion — manual, cannot be automated)**

- In BOTH the Dev and Ambassador booking DBs, add an `Invited` option to the Luma-status select (the hub push will also create it on first write, but add it so views can reference it).
- Filter `Invited` OUT of the active 1:1 pipeline views so invited guests don't clutter the claimable list.

- [ ] **Step 3: Live smoke (safe)**

Trigger the `luma-stats` sync for Singapore (or run its path) and confirm: a known `invited` guest (e.g. `nancy.y.chen@gmail.com`, `approval_status: "invited"`) is ingested as `luma_status = 'invited'`, mirrored to both Notion DBs, and NOT selected by `selectDeclinablePendings`. Run the sync again and confirm the change-guard skips them (no re-push). Confirm an accept (status → approved, with answers) transitions the same row via the webhook.

- [ ] **Step 4: Open the PR**

```bash
git push
gh pr create --base main --title "feat: invited-guest status + auto-sync" --body "Implements docs/superpowers/specs/2026-10-14-invited-status-sync-design.md. Removes the redundant completion-form feature."
```

---

## Self-review notes (spec coverage)

- Spec §1 `invited` status → Task 1. §2 ingestion on luma-stats cron + change-guard → Tasks 3, 4. §3 Notion mirror (automatic via ingest) + `Invited` label → Task 2 + Task 7 operator steps. §4 pipeline protection → Task 5 (emergent; regression-locked). §5 transition on accept → existing webhook (smoke in Task 7). §7 removal → Task 6. §8 testing → each task.
- Deploy order: apply the Task 1 migration to prod + regen types BEFORE deploying code that reads `luma_status === "invited"`.
