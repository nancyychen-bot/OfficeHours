# Slack Recruit Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-post an unclaimed Slack recruit card ~3 days after the first post and again 2 days before the event, so open 1:1 slots don't get missed.

**Architecture:** Two nullable timestamp columns on `bookings` track each reminder stage (reset on a fresh recruit). A new daily cron fetches still-open recruited bookings and a pure `selectDueRecruitReminders` decides which stages are due; the cron posts at most one reminder per booking per day (collapsing same-day stages) via a reminder-flavored recruit card. Never fires after the event.

**Tech Stack:** Next.js 15 / TypeScript, Supabase (Postgres), Slack incoming webhooks, Vitest.

**Reference spec:** `docs/superpowers/specs/2026-08-19-slack-recruit-reminders-design.md`

---

## File Structure

**Create:**
- `supabase/migrations/0043_bookings_slack_recruit_reminders.sql` — the two columns.
- `lib/events/recruit-reminder.ts` — pure `selectDueRecruitReminders`.
- `tests/recruit-reminder.test.ts` — unit tests for the selector.
- `app/api/cron/recruit-reminder/route.ts` — the daily cron.

**Modify:**
- `lib/supabase/types.ts` — hand-patch `bookings` Row/Insert/Update with the two columns.
- `lib/db/slack.ts` — reset stages in `setRecruitPostedAt`; add `markRecruitReminderSent`.
- `lib/db/bookings.ts` — add `listRecruitReminderCandidates`.
- `lib/slack/client.ts` — `reminder?` on `RecruitInput` + header swap in `buildRecruitBlocks`; add `postSlackRecruitReminder` (+ shared `buildRecruitContext` helper).
- `tests/slack.test.ts` — assert the reminder header.
- `vercel.json` — register the cron.

**Build order:** data model (T1) → pure selector (T2) → slack reminder card (T3) → DB fetch + setters (T4) → cron (T5) → verify + deploy (T6).

**Testing note:** `npm test` runs vitest; single file `npx vitest run tests/<file>.test.ts`; `npm run typecheck`. Migrations are applied to the live DB by the controller (Supabase CLI isn't authed); `lib/supabase/types.ts` is hand-patched, per existing repo practice.

---

## Task 1: Migration — recruit-reminder columns

**Files:**
- Create: `supabase/migrations/0043_bookings_slack_recruit_reminders.sql`
- Modify: `lib/supabase/types.ts`

- [ ] **Step 1: Write the migration**

```sql
-- Track the two recruit-reminder stages per booking (null = not yet sent).
-- r1 = "3 days after first recruit post"; r2 = "2 days before the event".
alter table bookings
  add column slack_recruit_r1_at timestamptz,
  add column slack_recruit_r2_at timestamptz;
```

- [ ] **Step 2: Apply the migration to the live DB**

The controller runs this SQL via the Supabase MCP (`apply_migration`, name `bookings_slack_recruit_reminders`). Confirm success before continuing.

- [ ] **Step 3: Hand-patch the generated types**

In `lib/supabase/types.ts`, find the `bookings` table's `Row`, `Insert`, and `Update` objects. Add (next to the existing `slack_recruit_posted_at` entries):

Row (non-optional, nullable):
```ts
          slack_recruit_r1_at: string | null
          slack_recruit_r2_at: string | null
```
Insert and Update (optional, nullable):
```ts
          slack_recruit_r1_at?: string | null
          slack_recruit_r2_at?: string | null
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: passes (no usages yet; just confirms the type edit is well-formed).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0043_bookings_slack_recruit_reminders.sql lib/supabase/types.ts
git commit -m "feat(recruit): bookings.slack_recruit_r1_at/r2_at columns"
```

---

## Task 2: Pure selector — `selectDueRecruitReminders`

**Files:**
- Create: `tests/recruit-reminder.test.ts`
- Create: `lib/events/recruit-reminder.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { selectDueRecruitReminders, type RecruitReminderRow } from "@/lib/events/recruit-reminder";

const NOW = Date.parse("2026-08-19T15:00:00.000Z");
const DAY = 24 * 60 * 60_000;

function row(over: Partial<RecruitReminderRow> = {}): RecruitReminderRow {
  return {
    id: "b1",
    slack_recruit_posted_at: new Date(NOW - 10 * DAY).toISOString(), // long ago
    slack_recruit_r1_at: null,
    slack_recruit_r2_at: null,
    event_date: "2026-09-30", // far future
    ...over,
  };
}

describe("selectDueRecruitReminders", () => {
  it("marks r1 due once 3 days have passed since the first post", () => {
    const r = selectDueRecruitReminders([row({ slack_recruit_posted_at: new Date(NOW - 3 * DAY).toISOString() })], NOW);
    expect(r).toEqual([{ id: "b1", stages: ["r1"] }]);
  });

  it("does not mark r1 before 3 days have passed", () => {
    const r = selectDueRecruitReminders([row({ slack_recruit_posted_at: new Date(NOW - 2 * DAY).toISOString() })], NOW);
    expect(r).toEqual([]);
  });

  it("skips r1 when it was already sent", () => {
    const r = selectDueRecruitReminders(
      [row({ slack_recruit_posted_at: new Date(NOW - 5 * DAY).toISOString(), slack_recruit_r1_at: new Date(NOW - DAY).toISOString() })],
      NOW,
    );
    expect(r).toEqual([]);
  });

  it("marks r2 due when today is within 2 calendar days of the event", () => {
    // event two days out, first post recent (r1 not yet due)
    const r = selectDueRecruitReminders(
      [row({ slack_recruit_posted_at: new Date(NOW - DAY).toISOString(), event_date: "2026-08-21" })],
      NOW,
    );
    expect(r).toEqual([{ id: "b1", stages: ["r2"] }]);
  });

  it("does not mark r2 when the event is more than 2 days out", () => {
    const r = selectDueRecruitReminders(
      [row({ slack_recruit_posted_at: new Date(NOW - DAY).toISOString(), event_date: "2026-08-25" })],
      NOW,
    );
    expect(r).toEqual([]);
  });

  it("skips r2 when it was already sent", () => {
    const r = selectDueRecruitReminders(
      [row({ slack_recruit_posted_at: new Date(NOW - DAY).toISOString(), event_date: "2026-08-21", slack_recruit_r2_at: new Date(NOW - DAY).toISOString() })],
      NOW,
    );
    expect(r).toEqual([]);
  });

  it("collapses both stages into one entry when both are due the same day", () => {
    const r = selectDueRecruitReminders(
      [row({ slack_recruit_posted_at: new Date(NOW - 4 * DAY).toISOString(), event_date: "2026-08-20" })],
      NOW,
    );
    expect(r).toEqual([{ id: "b1", stages: ["r1", "r2"] }]);
  });

  it("returns only rows that have a due stage", () => {
    const rows = [
      row({ id: "due", slack_recruit_posted_at: new Date(NOW - 3 * DAY).toISOString() }),
      row({ id: "notdue", slack_recruit_posted_at: new Date(NOW - DAY).toISOString() }),
    ];
    expect(selectDueRecruitReminders(rows, NOW)).toEqual([{ id: "due", stages: ["r1"] }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/recruit-reminder.test.ts`
Expected: FAIL — cannot find module `@/lib/events/recruit-reminder`.

- [ ] **Step 3: Implement the selector**

Create `lib/events/recruit-reminder.ts`:

```ts
/**
 * Decide which recruit reminders are due for still-open recruited bookings.
 * Pure + unit-tested; the caller (comms/recruit cron) fetches candidates and
 * posts. "Never after the event" is enforced by the candidate query, not here.
 *
 * - r1: 3 days after the first recruit post (slack_recruit_posted_at).
 * - r2: within `r2DaysBeforeEvent` calendar days of the event.
 * Stages already stamped (r1_at / r2_at set) are skipped. Both due the same day
 * collapse into one entry so the caller posts once and marks both.
 */
export interface RecruitReminderRow {
  id: string;
  slack_recruit_posted_at: string; // non-null (candidates only)
  slack_recruit_r1_at: string | null;
  slack_recruit_r2_at: string | null;
  event_date: string; // "YYYY-MM-DD"
}

export interface DueReminder {
  id: string;
  stages: Array<"r1" | "r2">;
}

/** UTC midnight (ms) for a plain "YYYY-MM-DD" — no timezone shift. */
function dateUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function selectDueRecruitReminders(
  rows: RecruitReminderRow[],
  nowMs: number,
  r1AfterMs = 3 * 24 * 60 * 60_000,
  r2DaysBeforeEvent = 2,
): DueReminder[] {
  const now = new Date(nowMs);
  const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const out: DueReminder[] = [];
  for (const r of rows) {
    const stages: Array<"r1" | "r2"> = [];
    if (r.slack_recruit_r1_at == null && nowMs >= Date.parse(r.slack_recruit_posted_at) + r1AfterMs) {
      stages.push("r1");
    }
    if (r.slack_recruit_r2_at == null && todayUtcMs >= dateUtcMs(r.event_date) - r2DaysBeforeEvent * 24 * 60 * 60_000) {
      stages.push("r2");
    }
    if (stages.length) out.push({ id: r.id, stages });
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/recruit-reminder.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/events/recruit-reminder.ts tests/recruit-reminder.test.ts
git commit -m "feat(recruit): pure selectDueRecruitReminders + tests"
```

---

## Task 3: Reminder-flavored recruit card

**Files:**
- Modify: `lib/slack/client.ts` (`RecruitInput` type + `buildRecruitBlocks`)
- Modify: `tests/slack.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/slack.test.ts` (it already imports from `@/lib/slack/client`; if `buildRecruitBlocks` isn't imported there yet, add it to the existing import):

```ts
import { buildRecruitBlocks } from "@/lib/slack/client";

describe("buildRecruitBlocks header", () => {
  const base = { guestName: "Bonnie Cao", role: "CEO", company: "Lindr", challenge: "Ops dashboard", eventName: "Notion Build Bar NYC", eventDate: "2026-08-26", slotName: "2:00-2:30PM", location: "New York", devCardUrl: "https://d", ambassadorCardUrl: "https://a" };
  const headerOf = (blocks: unknown[]) => (blocks[0] as { text: { text: string } }).text.text;

  it("uses the fresh-opening header by default", () => {
    expect(headerOf(buildRecruitBlocks(base))).toContain("just opened up");
  });

  it("uses the still-open header when reminder is set", () => {
    const text = headerOf(buildRecruitBlocks({ ...base, reminder: true }));
    expect(text).toContain("Still open");
    expect(text).not.toContain("just opened up");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/slack.test.ts`
Expected: FAIL — `reminder` not on `RecruitInput` (type error) and/or header assertion fails.

- [ ] **Step 3: Add `reminder?` to `RecruitInput` and swap the header**

In `lib/slack/client.ts`, add to the `RecruitInput` interface:
```ts
  /** Reminder re-post of a still-unclaimed slot (changes the header only). */
  reminder?: boolean;
```

In `buildRecruitBlocks`, replace the first block's hardcoded header line:
```ts
    { type: "section", text: { type: "mrkdwn", text: "*🙋 A 1:1 slot just opened up — can anyone cover it?*" } },
```
with:
```ts
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: i.reminder
          ? "*⏰ Still open — this 1:1 still needs a Notion expert*"
          : "*🙋 A 1:1 slot just opened up — can anyone cover it?*",
      },
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/slack.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/slack/client.ts tests/slack.test.ts
git commit -m "feat(recruit): reminder header variant on the recruit card"
```

---

## Task 4: DB fetch + setters

**Files:**
- Modify: `lib/db/slack.ts` (`setRecruitPostedAt`, new `markRecruitReminderSent`)
- Modify: `lib/db/bookings.ts` (new `listRecruitReminderCandidates`)

- [ ] **Step 1: Reset stages in `setRecruitPostedAt` and add `markRecruitReminderSent`**

In `lib/db/slack.ts`, replace `setRecruitPostedAt` with:
```ts
/** Mark that a recruit post went out for this booking (so a later claim can
 * post a "covered" follow-up). Pass null to clear once the follow-up is sent.
 * Always resets the reminder stages: a fresh recruit starts a new cycle, and a
 * clear leaves no stale stamps. */
export async function setRecruitPostedAt(bookingId: string, at: string | null): Promise<void> {
  await getAdminClient()
    .from("bookings")
    .update({ slack_recruit_posted_at: at, slack_recruit_r1_at: null, slack_recruit_r2_at: null })
    .eq("id", bookingId);
}

/** Stamp the given recruit-reminder stages as sent. */
export async function markRecruitReminderSent(
  bookingId: string,
  stages: Array<"r1" | "r2">,
  at: string,
): Promise<void> {
  const patch: Record<string, string> = {};
  if (stages.includes("r1")) patch.slack_recruit_r1_at = at;
  if (stages.includes("r2")) patch.slack_recruit_r2_at = at;
  if (Object.keys(patch).length === 0) return;
  await getAdminClient().from("bookings").update(patch).eq("id", bookingId);
}
```

- [ ] **Step 2: Add `listRecruitReminderCandidates` to `lib/db/bookings.ts`**

Add the import at the top of `lib/db/bookings.ts` (next to the other `../events/...` import added earlier):
```ts
import type { RecruitReminderRow } from "../events/recruit-reminder";
```

Add the function (place it near `listBookingIdsNeedingAssignedComms`):
```ts
/**
 * Still-open recruited bookings that may need a Slack recruit reminder: a recruit
 * post went out (marker set), still unassigned + claimable, and the event hasn't
 * passed. Joined to the event for its date. Reminder timing is decided by
 * `selectDueRecruitReminders`.
 */
export async function listRecruitReminderCandidates(): Promise<RecruitReminderRow[]> {
  const supabase = getAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("bookings")
    .select("id, slack_recruit_posted_at, slack_recruit_r1_at, slack_recruit_r2_at, events!inner(event_date)")
    .not("slack_recruit_posted_at", "is", null)
    .eq("status", "unassigned")
    .eq("filtered", false)
    .eq("luma_status", "approved")
    .gte("events.event_date", today);
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id as string,
    slack_recruit_posted_at: r.slack_recruit_posted_at as string,
    slack_recruit_r1_at: (r.slack_recruit_r1_at as string | null) ?? null,
    slack_recruit_r2_at: (r.slack_recruit_r2_at as string | null) ?? null,
    event_date: (Array.isArray(r.events) ? r.events[0]?.event_date : r.events?.event_date) as string,
  }));
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 4: Run the full suite (nothing should break)**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/db/slack.ts lib/db/bookings.ts
git commit -m "feat(recruit): reminder-candidate query + stage setters"
```

---

## Task 5: `postSlackRecruitReminder` + daily cron

**Files:**
- Modify: `lib/slack/client.ts` (extract `buildRecruitContext`; add `postSlackRecruitReminder`)
- Create: `app/api/cron/recruit-reminder/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Extract the shared fetch/build and add the reminder poster**

In `lib/slack/client.ts`, refactor so `postSlackRecruit` and the new reminder share the fetch + block-input build. Add a private helper and the exported reminder function:

```ts
/** Resolve the channel + recruit-card input for a booking, or null if we can't
 * post (unknown booking/details, or the city has no channel — logged). Shared by
 * the first recruit post and the reminder re-post. */
async function buildRecruitContext(
  bookingId: string,
): Promise<{ channel: SlackChannel; input: RecruitInput } | null> {
  const booking = await getBookingById(bookingId);
  if (!booking) return null;
  const details = await getBookingDetailsById(bookingId);
  if (!details) return null;
  const f: CommsFields = toCommsFields(details);
  const channel = await getSlackChannelForCity(f.location);
  if (!channel) {
    await logSync({ direction: "luma_in", result: "applied", bookingId, action: "slack_recruit_skipped", note: `no channel for ${f.location ?? "?"}` });
    return null;
  }
  const [devCardUrl, ambassadorCardUrl] = await Promise.all([
    fetchCardUrl("dev", booking.notion_dev_page_id),
    fetchCardUrl("ambassador", booking.notion_ambassador_page_id),
  ]);
  return {
    channel,
    input: {
      guestName: f.guestName, role: f.role, company: f.company, challenge: f.challenge,
      eventName: f.eventName, eventDate: f.eventDate, slotName: f.slotName, location: f.location,
      devCardUrl, ambassadorCardUrl,
    },
  };
}

/** Re-post a still-unclaimed recruit slot as a reminder. Best-effort; does NOT
 * touch slack_recruit_posted_at (keeps the original first-post time). */
export async function postSlackRecruitReminder(bookingId: string): Promise<void> {
  try {
    const ctx = await buildRecruitContext(bookingId);
    if (!ctx) return;
    const blocks = buildRecruitBlocks({ ...ctx.input, reminder: true });
    await postToCityChannel(ctx.channel, blocks, "A recruited 1:1 slot is still open.");
    await logSync({ direction: "luma_in", result: "applied", bookingId, action: "slack_recruit_reminder_posted", note: ctx.channel.channelName ?? undefined });
  } catch (err) {
    await logSync({ direction: "luma_in", result: "error", bookingId, action: "slack_recruit_reminder", note: err instanceof Error ? err.message : String(err) });
  }
}
```

Then update the existing `postSlackRecruit` body to reuse the helper (behavior unchanged — still sets the marker and logs `slack_recruit_posted`):
```ts
export async function postSlackRecruit(bookingId: string): Promise<void> {
  try {
    const ctx = await buildRecruitContext(bookingId);
    if (!ctx) return;
    await postToCityChannel(ctx.channel, buildRecruitBlocks(ctx.input), "A 1:1 slot just opened up — can anyone cover it?");
    await setRecruitPostedAt(bookingId, new Date().toISOString());
    await logSync({ direction: "luma_in", result: "applied", bookingId, action: "slack_recruit_posted", note: ctx.channel.channelName ?? undefined });
  } catch (err) {
    await logSync({ direction: "luma_in", result: "error", bookingId, action: "slack_recruit", note: err instanceof Error ? err.message : String(err) });
  }
}
```

Ensure `SlackChannel` is imported in `client.ts` (it's from `../db/slack`, already used via `getSlackChannelForCity`; add `SlackChannel` to that import if not present).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Run the full suite (recruit posting untouched in behavior)**

Run: `npm test`
Expected: all pass.

- [ ] **Step 4: Create the cron route**

Create `app/api/cron/recruit-reminder/route.ts`:
```ts
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { listRecruitReminderCandidates } from "@/lib/db/bookings";
import { selectDueRecruitReminders } from "@/lib/events/recruit-reminder";
import { markRecruitReminderSent } from "@/lib/db/slack";
import { postSlackRecruitReminder } from "@/lib/slack/client";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Re-post still-unclaimed recruit slots. Vercel Cron calls this daily; it finds
 * recruited bookings that are still open (marker set, unassigned, approved, event
 * not passed) and posts a reminder ~3 days after the first post and again 2 days
 * before the event — at most one post per booking per day. Guarded by the shared
 * cron secret.
 */
export async function POST(req: Request) {
  const secret = env.app.cronSecret();
  const provided =
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const candidates = await listRecruitReminderCandidates();
  const due = selectDueRecruitReminders(candidates, Date.now());
  for (const { id, stages } of due) {
    await postSlackRecruitReminder(id);
    await markRecruitReminderSent(id, stages, new Date().toISOString());
    await logSync({ direction: "luma_in", result: "applied", bookingId: id, action: `slack_recruit_reminder:${stages.join("+")}` });
  }
  return NextResponse.json({ reminded: due.length });
}

// Vercel Cron issues GET by default; accept both.
export const GET = POST;
```

- [ ] **Step 5: Register the cron in `vercel.json`**

Add this entry to the `crons` array (after the `comms-retry` entry):
```json
    { "path": "/api/cron/recruit-reminder", "schedule": "0 15 * * *" },
```

- [ ] **Step 6: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add lib/slack/client.ts app/api/cron/recruit-reminder/route.ts vercel.json
git commit -m "feat(recruit): daily recruit-reminder cron + reminder poster"
```

---

## Task 6: Verify + deploy

**Files:** none (verification).

- [ ] **Step 1: Full green check**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass.

- [ ] **Step 2: Dry-check the candidate query against live data (read-only)**

Via Supabase MCP, run the equivalent SQL to sanity-check nothing unexpected matches:
```sql
select b.id, b.slack_recruit_posted_at, b.slack_recruit_r1_at, b.slack_recruit_r2_at, e.event_date
from bookings b join events e on e.id = b.event_id
where b.slack_recruit_posted_at is not null and b.status = 'unassigned'
  and b.filtered = false and b.luma_status = 'approved' and e.event_date >= current_date;
```
Expected: only genuinely-open recruited slots (possibly none). Confirm before deploy.

- [ ] **Step 3: Open a PR**

```bash
git push -u origin feat/slack-recruit-reminders
gh pr create --title "feat(recruit): Slack recruit reminders (3-day + 2-days-before)" --body "Implements docs/superpowers/specs/2026-08-19-slack-recruit-reminders-design.md — re-posts unclaimed recruit slots ~3 days after the first post and 2 days before the event (max one/booking/day, never after the event). New daily cron /api/cron/recruit-reminder."
```

- [ ] **Step 4: Deploy to production**

Run: `npx vercel --prod --yes`
Expected: `READY`. The new cron is registered from `vercel.json` on deploy.

- [ ] **Step 5: Post-deploy sanity**

Optionally trigger the cron once with the cron secret to confirm it runs clean:
```bash
curl -s -X POST -H "x-cron-secret: <CRON_SECRET>" https://office-hours-three.vercel.app/api/cron/recruit-reminder
```
Expected: `{"reminded": <n>}` with no error, and any posts show as `slack_recruit_reminder_posted` in `sync_log`.

---

## Notes / edge cases (baked into the tasks)

- **Never after the event:** the candidate query requires `event_date >= today`, so no stage fires post-event.
- **Max one post/day, up to 2 total:** the cron posts once per due booking and `markRecruitReminderSent` stamps every currently-due stage, collapsing a same-day r1+r2 into a single post; the other stage fires on a later day only if it comes due later and the slot is still open.
- **Fresh recruit resets the cycle:** `setRecruitPostedAt(id, <now>)` nulls both stage columns.
- **Claimed slots drop out:** `postSlackClaimed` calls `setRecruitPostedAt(id, null)`, clearing the marker (and stages), so a claimed booking is never a candidate.
