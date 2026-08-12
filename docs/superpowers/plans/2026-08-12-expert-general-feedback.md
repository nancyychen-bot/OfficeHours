# Expert General Feedback + Hub View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let experts add general feedback/learnings from the Slack modal (stored as one guest-less "General" entry per expert/event, synced to Notion with a Feedback-type select), and surface all Slack-captured expert feedback in a new read-only hub tab.

**Architecture:** A new `expert_general_feedback` table (keyed by event+expert) holds general text; the per-1:1 modal gains a general box that upserts it and syncs a "General"-typed page into the same Dev feedback DB (Guest blank, Note reused). Per-1:1 rows are tagged "Guest". A new hub tab lists both.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase, `@notionhq/client` v5, Vitest.

**Reference spec:** `docs/superpowers/specs/2026-08-12-expert-general-feedback-design.md`

---

## File Structure

**Create:**
- `supabase/migrations/0042_expert_general_feedback.sql`
- `lib/db/expert-general-feedback.ts` — upsert/get/list + notion-page-id setter.
- `lib/notion/expert-general-feedback.ts` — mapper + race-safe `pushGeneralFeedback`.
- `lib/hub/expert-feedback.ts` — unified read for the hub tab.
- `app/expert-feedback/page.tsx`, `components/hub/ExpertFeedbackTab.tsx`
- Tests: `tests/expert-general-feedback-notion.test.ts` (+ extend `tests/slack-interactivity.test.ts`, `tests/expert-feedback-notion.test.ts`).

**Modify:**
- `lib/supabase/types.ts` — add `expert_general_feedback` table.
- `lib/slack/interaction.ts` — modal general field + parse.
- `app/api/slack/interactivity/route.ts` — prefill + upsert/push general.
- `lib/notion/expert-feedback.ts` — `EF.feedbackType`, tag per-1:1 rows "Guest".
- `scripts/configure-expert-feedback-db.ts` — add "Feedback type" select property.
- `components/hub/HubNav.tsx` — new tab.

**Controller (not code tasks):** apply migration 0042; run `npm run setup:expert-feedback` to add the Feedback-type property.

**Build order:** table (T1) → general db (T2) → modal+parse (T3) → route wiring (T4) → per-1:1 "Guest" tag + property (T5) → general Notion sync (T6) → hub read (T7) → hub tab/nav (T8) → verify (T9).

**Testing note:** `npm test`; single file `npx vitest run tests/<file>.test.ts`; `npm run typecheck`.

---

## Task 1: Migration — `expert_general_feedback`

**Files:** Create `supabase/migrations/0042_expert_general_feedback.sql`; modify `lib/supabase/types.ts`.

Do NOT apply the migration or run `gen:types` (CLI unauthenticated). Create SQL + hand-patch types; controller applies DDL.

- [ ] **Step 1: Migration**

```sql
-- 0042_expert_general_feedback.sql
-- General feedback/learnings from an expert about an event (not tied to a guest).
-- One row per (event, expert). Synced one-way to the same Dev feedback Notion DB
-- as a "General"-typed page (Guest blank).
create table if not exists expert_general_feedback (
  event_id uuid not null references events(id) on delete cascade,
  expert_email text not null,
  expert_name text,
  note text,
  event_name text,
  event_date date,
  location text,
  notion_dev_page_id text,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, expert_email)
);
```

- [ ] **Step 2: Hand-patch `lib/supabase/types.ts`**

Add an `expert_general_feedback` table block inside `Tables` (alphabetically after `expert_feedback`), mirroring the shape of other tables:

```typescript
      expert_general_feedback: {
        Row: {
          created_at: string
          event_date: string | null
          event_id: string
          event_name: string | null
          expert_email: string
          expert_name: string | null
          location: string | null
          note: string | null
          notion_dev_page_id: string | null
          responded_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_date?: string | null
          event_id: string
          event_name?: string | null
          expert_email: string
          expert_name?: string | null
          location?: string | null
          note?: string | null
          notion_dev_page_id?: string | null
          responded_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_date?: string | null
          event_id?: string
          event_name?: string | null
          expert_email?: string
          expert_name?: string | null
          location?: string | null
          note?: string | null
          notion_dev_page_id?: string | null
          responded_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck` → no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0042_expert_general_feedback.sql lib/supabase/types.ts
git commit -m "feat(feedback): expert_general_feedback table"
```

---

## Task 2: General-feedback DB access

**Files:** Create `lib/db/expert-general-feedback.ts`.

- [ ] **Step 1: Implement**

```typescript
import { getAdminClient } from "../supabase/admin";

export interface GeneralFeedbackInput {
  eventId: string;
  expertEmail: string;
  expertName: string | null;
  note: string;
  eventName: string | null;
  eventDate: string | null;
  location: string | null;
}

export interface GeneralFeedbackRow {
  event_id: string;
  expert_email: string;
  expert_name: string | null;
  note: string | null;
  event_name: string | null;
  event_date: string | null;
  location: string | null;
  notion_dev_page_id: string | null;
  responded_at: string | null;
}

/** Upsert the single general entry for (event, expert). Preserves notion_dev_page_id
 * (not in the payload, so on-conflict update leaves it untouched). */
export async function upsertGeneralFeedback(input: GeneralFeedbackInput): Promise<void> {
  const now = new Date().toISOString();
  await getAdminClient().from("expert_general_feedback").upsert(
    {
      event_id: input.eventId,
      expert_email: input.expertEmail,
      expert_name: input.expertName,
      note: input.note,
      event_name: input.eventName,
      event_date: input.eventDate,
      location: input.location,
      responded_at: now,
      updated_at: now,
    },
    { onConflict: "event_id,expert_email" },
  );
}

export async function getGeneralFeedback(eventId: string, expertEmail: string): Promise<GeneralFeedbackRow | null> {
  const { data } = await getAdminClient()
    .from("expert_general_feedback")
    .select("*")
    .eq("event_id", eventId)
    .ilike("expert_email", expertEmail)
    .maybeSingle();
  return (data as GeneralFeedbackRow | null) ?? null;
}

export async function setGeneralFeedbackNotionPageId(eventId: string, expertEmail: string, pageId: string): Promise<void> {
  await getAdminClient()
    .from("expert_general_feedback")
    .update({ notion_dev_page_id: pageId })
    .eq("event_id", eventId)
    .eq("expert_email", expertEmail);
}

export async function listGeneralFeedback(): Promise<GeneralFeedbackRow[]> {
  const { data } = await getAdminClient()
    .from("expert_general_feedback")
    .select("*")
    .order("event_date", { ascending: false });
  return (data as GeneralFeedbackRow[] | null) ?? [];
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` → no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/db/expert-general-feedback.ts
git commit -m "feat(feedback): expert_general_feedback db access"
```

---

## Task 3: Modal general field + parse

**Files:** Modify `lib/slack/interaction.ts`; test `tests/slack-interactivity.test.ts`.

- [ ] **Step 1: Write failing tests (extend `tests/slack-interactivity.test.ts`)**

```typescript
describe("parseInteraction — general feedback", () => {
  it("reads the general field on submit", () => {
    const payload = {
      type: "view_submission",
      view: {
        private_metadata: "b1",
        state: { values: { general: { general_v: { value: "great crowd, more power strips" } } } },
      },
    };
    expect(parseInteraction(payload)).toMatchObject({ kind: "feedback_submit", bookingId: "b1", general: "great crowd, more power strips" });
  });
  it("leaves general undefined when blank", () => {
    const payload = { type: "view_submission", view: { private_metadata: "b2", state: { values: {} } } };
    expect((parseInteraction(payload) as { general?: string }).general).toBeUndefined();
  });
});

describe("feedbackModalView — general field", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const find = (v: any, id: string) => v.blocks.find((b: any) => b.block_id === id);
  it("includes a general input, pre-filled when provided", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = feedbackModalView("b1", { guestName: "Ada", general: "learned a lot" }) as any;
    expect(find(v, "general").element.initial_value).toBe("learned a lot");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/slack-interactivity.test.ts`
Expected: FAIL — `general` missing on parse / modal.

- [ ] **Step 3: Implement**

In `lib/slack/interaction.ts`:

1. Add `general?: string` to the `feedback_submit` variant:

```typescript
  | { kind: "feedback_submit"; bookingId: string; attended?: boolean; rating?: number; note?: string; general?: string }
```

2. In `parseInteraction`'s `view_submission` branch, read the general value and include it:

```typescript
    const generalVal = values.general?.general_v?.value as string | undefined;
    const general = typeof generalVal === "string" && generalVal.trim() !== "" ? generalVal : undefined;
    return { kind: "feedback_submit", bookingId, attended, rating, note, general };
```

3. Add `general?: string | null` to `FeedbackModalState`, and add a general input block to `feedbackModalView` after the `note` block:

```typescript
      {
        type: "input",
        block_id: "general",
        optional: true,
        label: { type: "plain_text", text: "General feedback & learnings" },
        element: {
          type: "plain_text_input",
          action_id: "general_v",
          multiline: true,
          ...(state.general ? { initial_value: state.general } : {}),
        },
      },
```

- [ ] **Step 4: Run to verify pass + typecheck**

Run: `npx vitest run tests/slack-interactivity.test.ts && npm run typecheck`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/slack/interaction.ts tests/slack-interactivity.test.ts
git commit -m "feat(feedback): general feedback field in the Slack modal + parse"
```

---

## Task 4: Route wiring (prefill + upsert/push general)

**Files:** Modify `app/api/slack/interactivity/route.ts`.

Depends on `pushGeneralFeedback` (Task 6). To keep the route compiling before Task 6, this task adds the imports/calls; run its typecheck AFTER Task 6, or stub. To avoid ordering pain, implement Task 6 before this task's typecheck. (Committing order: do Task 6 first if executing strictly; the plan lists 4 before 6 for narrative flow but they commit together-safe since both are new/added code. If typecheck fails on the missing import, proceed to Task 6 then re-typecheck.)

- [ ] **Step 1: Imports**

```typescript
import { getFeedbackRow, upsertFeedbackAnswer } from "@/lib/db/expert-feedback";
import { getGeneralFeedback, upsertGeneralFeedback } from "@/lib/db/expert-general-feedback";
import { pushExpertFeedback } from "@/lib/notion/expert-feedback";
import { pushGeneralFeedback } from "@/lib/notion/expert-general-feedback";
```

(Replace the existing `getFeedbackRow, upsertFeedbackAnswer` import line accordingly.)

- [ ] **Step 2: Prefill the general box on open**

Replace the `open_feedback` case body with:

```typescript
      case "open_feedback": {
        const row = await getFeedbackRow(interaction.bookingId);
        const gen = row?.event_id ? await getGeneralFeedback(row.event_id, row.expert_email) : null;
        await openModal(
          interaction.triggerId,
          feedbackModalView(interaction.bookingId, {
            guestName: row?.guest_name ?? "this guest",
            attended: row?.attended,
            rating: row?.rating,
            note: row?.note,
            general: gen?.note ?? null,
          }),
        );
        break;
      }
```

- [ ] **Step 3: Upsert + push general on submit**

Replace the `feedback_submit` case body with:

```typescript
      case "feedback_submit": {
        await upsertFeedbackAnswer(interaction.bookingId, {
          attended: interaction.attended,
          rating: interaction.rating,
          note: interaction.note,
        });
        after(() => pushExpertFeedback(interaction.bookingId));
        if (interaction.general) {
          const row = await getFeedbackRow(interaction.bookingId);
          if (row?.event_id) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: bd } = await (getAdminClient() as any)
              .from("booking_details")
              .select("event_name, event_date, location")
              .eq("id", interaction.bookingId)
              .maybeSingle();
            await upsertGeneralFeedback({
              eventId: row.event_id,
              expertEmail: row.expert_email,
              expertName: row.expert_name,
              note: interaction.general,
              eventName: bd?.event_name ?? null,
              eventDate: bd?.event_date ?? null,
              location: bd?.location ?? null,
            });
            after(() => pushGeneralFeedback(row.event_id as string, row.expert_email));
          }
        }
        break;
      }
```

Add the import for the admin client at the top:

```typescript
import { getAdminClient } from "@/lib/supabase/admin";
```

- [ ] **Step 4: Typecheck (after Task 6 exists)**

Run: `npm run typecheck`
Expected: no errors once `lib/notion/expert-general-feedback.ts` (Task 6) exists.

- [ ] **Step 5: Commit**

```bash
git add "app/api/slack/interactivity/route.ts"
git commit -m "feat(feedback): capture + sync general feedback from the modal"
```

---

## Task 5: Tag per-1:1 rows "Guest" + add the property

**Files:** Modify `lib/notion/expert-feedback.ts`, `scripts/configure-expert-feedback-db.ts`; test `tests/expert-feedback-notion.test.ts`.

- [ ] **Step 1: Write failing test (extend `tests/expert-feedback-notion.test.ts`)**

```typescript
it("tags the per-1:1 row as Feedback type = Guest", () => {
  const props = expertFeedbackProperties({
    booking_id: "b1", expert_email: "g@x.com", expert_name: "G",
    guest_name: "Ada", guest_email: null, attended: true, rating: 4, note: null,
    responded_at: null, slot_name: null, event_name: null, event_date: null, location: null,
    booking_dev_page_id: null,
  });
  expect((props["Feedback type"] as { select: { name: string } }).select.name).toBe("Guest");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/expert-feedback-notion.test.ts`
Expected: FAIL — `Feedback type` missing.

- [ ] **Step 3: Implement**

In `lib/notion/expert-feedback.ts`, add to the `EF` constant:

```typescript
  feedbackType: "Feedback type",
```

In `expertFeedbackProperties`, add to the returned object:

```typescript
    [EF.feedbackType]: { select: { name: "Guest" } },
```

In `scripts/configure-expert-feedback-db.ts`, add to the `properties` object:

```typescript
    "Feedback type": { select: { options: [{ name: "Guest", color: "blue" }, { name: "General", color: "purple" }] } },
```

- [ ] **Step 4: Run to verify pass + typecheck**

Run: `npx vitest run tests/expert-feedback-notion.test.ts && npm run typecheck`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/notion/expert-feedback.ts scripts/configure-expert-feedback-db.ts tests/expert-feedback-notion.test.ts
git commit -m "feat(feedback): tag per-1:1 rows Feedback type=Guest + add the select property"
```

---

## Task 6: General feedback Notion sync

**Files:** Create `lib/notion/expert-general-feedback.ts`; test `tests/expert-general-feedback-notion.test.ts`.

- [ ] **Step 1: Write failing mapper test**

```typescript
// tests/expert-general-feedback-notion.test.ts
import { describe, it, expect } from "vitest";
import { generalFeedbackProperties } from "../lib/notion/expert-general-feedback";

describe("generalFeedbackProperties", () => {
  it("maps a general entry: type General, guest blank, note set", () => {
    const props = generalFeedbackProperties({
      expert_name: "Grace", expert_email: "g@x.com", note: "great venue, more outlets",
      event_name: "NYC", event_date: "2026-08-26", location: "New York", responded_at: "2026-08-26T22:00:00Z",
    });
    expect((props["Feedback type"] as { select: { name: string } }).select.name).toBe("General");
    expect((props["Note"] as { rich_text: Array<{ text: { content: string } }> }).rich_text[0].text.content).toContain("great venue");
    expect((props["Guest"] as { rich_text: unknown[] }).rich_text).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/expert-general-feedback-notion.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `lib/notion/expert-general-feedback.ts`**

```typescript
import { getNotionClient } from "./client";
import { env } from "../env";
import { getGeneralFeedback, setGeneralFeedbackNotionPageId } from "../db/expert-general-feedback";
import { getAdminClient } from "../supabase/admin";
import { EF } from "./expert-feedback";
import { logSync } from "../sync/log";

const PENDING = "pending";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Props = Record<string, unknown>;
function rich(text: string | null): { rich_text: Array<{ type: "text"; text: { content: string } }> } {
  return { rich_text: text ? [{ type: "text", text: { content: text.slice(0, 2000) } }] : [] };
}

export interface GeneralFeedbackNotionRow {
  expert_name: string | null;
  expert_email: string;
  note: string | null;
  event_name: string | null;
  event_date: string | null;
  location: string | null;
  responded_at: string | null;
}

/** Pure: map a general entry to Dev Notion properties (Guest/Rating/Attended/Slot/Booking left blank). */
export function generalFeedbackProperties(r: GeneralFeedbackNotionRow): Props {
  return {
    [EF.expert]: { title: r.expert_name ? [{ type: "text", text: { content: r.expert_name.slice(0, 2000) } }] : [] },
    [EF.expertEmail]: rich(r.expert_email),
    [EF.guest]: rich(null),
    [EF.event]: rich(r.event_name),
    [EF.eventDate]: { date: r.event_date ? { start: r.event_date } : null },
    [EF.location]: rich(r.location),
    [EF.note]: rich(r.note),
    [EF.respondedAt]: { date: r.responded_at ? { start: r.responded_at } : null },
    [EF.feedbackType]: { select: { name: "General" } },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolvePageId(supabase: any, client: ReturnType<typeof getNotionClient>, dataSourceId: string, eventId: string, expertEmail: string, currentPageId: string | null, props: Props): Promise<string | null> {
  if (currentPageId && currentPageId !== PENDING) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing = (await client.pages.retrieve({ page_id: currentPageId })) as any;
      if (!existing.archived && !existing.in_trash) return currentPageId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/not[ _]?found|could not find/i.test(msg)) throw err;
    }
    await supabase.from("expert_general_feedback").update({ notion_dev_page_id: null }).eq("event_id", eventId).eq("expert_email", expertEmail).eq("notion_dev_page_id", currentPageId);
  }
  const { data: claimed } = await supabase
    .from("expert_general_feedback")
    .update({ notion_dev_page_id: PENDING })
    .eq("event_id", eventId)
    .eq("expert_email", expertEmail)
    .is("notion_dev_page_id", null)
    .select("event_id");
  if (claimed && claimed.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = (await client.pages.create({ parent: { type: "data_source_id", data_source_id: dataSourceId }, properties: props as any } as any)) as any;
    await setGeneralFeedbackNotionPageId(eventId, expertEmail, created.id as string);
    return created.id as string;
  }
  for (let i = 0; i < 10; i++) {
    await sleep(400);
    const { data } = await supabase.from("expert_general_feedback").select("notion_dev_page_id").eq("event_id", eventId).eq("expert_email", expertEmail).maybeSingle();
    const v = data?.notion_dev_page_id as string | null | undefined;
    if (v && v !== PENDING) return v;
  }
  return null;
}

/** One-way, race-safe push of a general entry to the Dev feedback DB. Best-effort. */
export async function pushGeneralFeedback(eventId: string, expertEmail: string): Promise<void> {
  const dataSourceId = env.notionDev.expertFeedbackDataSourceId();
  if (!dataSourceId) return;
  try {
    const row = await getGeneralFeedback(eventId, expertEmail);
    if (!row) return;
    const props = generalFeedbackProperties({
      expert_name: row.expert_name,
      expert_email: row.expert_email,
      note: row.note,
      event_name: row.event_name,
      event_date: row.event_date,
      location: row.location,
      responded_at: row.responded_at,
    });
    const client = getNotionClient("dev");
    const pageId = await resolvePageId(getAdminClient(), client, dataSourceId, eventId, expertEmail, row.notion_dev_page_id, props);
    if (!pageId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await client.pages.update({ page_id: pageId, properties: props as any });
  } catch (err) {
    await logSync({ direction: "hub_to_dev", result: "error", action: "expert_general_feedback_notion", note: err instanceof Error ? err.message : String(err) });
  }
}
```

(`EF` is imported from `./expert-feedback`, so `EF.feedbackType` etc. come from Task 5.)

- [ ] **Step 4: Run to verify pass + typecheck**

Run: `npx vitest run tests/expert-general-feedback-notion.test.ts && npm run typecheck`
Expected: PASS; no type errors (this resolves the Task 4 import too).

- [ ] **Step 5: Commit (Tasks 4 + 6 together, since the route imports this)**

```bash
git add lib/notion/expert-general-feedback.ts tests/expert-general-feedback-notion.test.ts "app/api/slack/interactivity/route.ts"
git commit -m "feat(feedback): one-way race-safe Notion sync for general feedback + route wiring"
```

---

## Task 7: Hub read

**Files:** Create `lib/hub/expert-feedback.ts`.

- [ ] **Step 1: Implement**

```typescript
import { getAdminClient } from "../supabase/admin";
import { listGeneralFeedback } from "../db/expert-general-feedback";

export interface ExpertFeedbackListRow {
  type: "Guest" | "General";
  expert: string | null;
  eventName: string | null;
  eventDate: string | null;
  guest: string | null;
  attended: boolean | null;
  rating: number | null;
  note: string | null;
  respondedAt: string | null;
}

/** Unified, read-only list of Slack-captured expert feedback: per-1:1 Guest rows +
 * per-event General rows, newest event first. */
export async function listExpertFeedback(): Promise<ExpertFeedbackListRow[]> {
  const supabase = getAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: guest } = await (supabase as any)
    .from("expert_feedback")
    .select("expert_name, guest_name, attended, rating, note, responded_at, event_id");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: events } = await (supabase as any).from("events").select("id, name, event_date");
  const evMap = new Map<string, { name: string | null; date: string | null }>();
  for (const e of (events ?? [])) evMap.set(e.id, { name: e.name ?? null, date: e.event_date ?? null });

  const guestRows: ExpertFeedbackListRow[] = (guest ?? []).map((r: Record<string, unknown>) => ({
    type: "Guest" as const,
    expert: (r.expert_name as string) ?? null,
    eventName: evMap.get(r.event_id as string)?.name ?? null,
    eventDate: evMap.get(r.event_id as string)?.date ?? null,
    guest: (r.guest_name as string) ?? null,
    attended: (r.attended as boolean) ?? null,
    rating: (r.rating as number) ?? null,
    note: (r.note as string) ?? null,
    respondedAt: (r.responded_at as string) ?? null,
  }));

  const generalRows: ExpertFeedbackListRow[] = (await listGeneralFeedback()).map((r) => ({
    type: "General" as const,
    expert: r.expert_name,
    eventName: r.event_name,
    eventDate: r.event_date,
    guest: null,
    attended: null,
    rating: null,
    note: r.note,
    respondedAt: r.responded_at,
  }));

  return [...guestRows, ...generalRows].sort((a, b) => (b.eventDate ?? "").localeCompare(a.eventDate ?? ""));
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` → no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/hub/expert-feedback.ts
git commit -m "feat(hub): unified expert-feedback read (guest + general)"
```

---

## Task 8: Hub tab + nav

**Files:** Create `app/expert-feedback/page.tsx`, `components/hub/ExpertFeedbackTab.tsx`; modify `components/hub/HubNav.tsx`.

- [ ] **Step 1: Nav entry**

In `components/hub/HubNav.tsx`, add after the Feedback entry:

```typescript
  { href: "/expert-feedback", label: "Expert Feedback" },
```

- [ ] **Step 2: Tab component `components/hub/ExpertFeedbackTab.tsx`**

```tsx
import type { ExpertFeedbackListRow } from "@/lib/hub/expert-feedback";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function prettyDate(iso: string | null): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : iso;
}

export function ExpertFeedbackTab({ rows }: { rows: ExpertFeedbackListRow[] }) {
  if (!rows.length) return <p className="text-sm text-neutral-500">No expert feedback yet.</p>;
  const th = "px-3 py-2 text-left text-xs font-medium text-neutral-500";
  const td = "px-3 py-2 align-top text-sm text-neutral-700";
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200">
      <table className="min-w-full divide-y divide-neutral-200">
        <thead className="bg-neutral-50">
          <tr>
            <th className={th}>Type</th><th className={th}>Expert</th><th className={th}>Event</th>
            <th className={th}>Date</th><th className={th}>Guest</th><th className={th}>Attended</th>
            <th className={th}>Rating</th><th className={th}>Note</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r, i) => (
            <tr key={i} className={r.type === "General" ? "bg-purple-50/40" : ""}>
              <td className={td}>{r.type}</td>
              <td className={td}>{r.expert ?? "—"}</td>
              <td className={td}>{r.eventName ?? "—"}</td>
              <td className={td}>{prettyDate(r.eventDate)}</td>
              <td className={td}>{r.guest ?? "—"}</td>
              <td className={td}>{r.attended === null ? "—" : r.attended ? "✅" : "🚫"}</td>
              <td className={td}>{r.rating ?? "—"}</td>
              <td className={`${td} max-w-[420px] whitespace-pre-wrap`}>{r.note ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Page `app/expert-feedback/page.tsx`**

```tsx
import { listExpertFeedback } from "@/lib/hub/expert-feedback";
import { HubNav } from "@/components/hub/HubNav";
import { ExpertFeedbackTab } from "@/components/hub/ExpertFeedbackTab";

export const dynamic = "force-dynamic";

export default async function ExpertFeedbackPage() {
  const rows = await listExpertFeedback();
  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <HubNav />
      <p className="mb-5 max-w-2xl text-sm text-neutral-500">
        Feedback experts submitted in Slack after their 1:1s — per-guest (Guest) and overall (General).
      </p>
      <ExpertFeedbackTab rows={rows} />
    </main>
  );
}
```

- [ ] **Step 4: Typecheck + build-sanity**

Run: `npm run typecheck`
Expected: no errors. (Middleware already guards `/expert-feedback` — it's not in the public matcher exclusions, so it requires a session. Confirm with `grep -n matcher middleware.ts`.)

- [ ] **Step 5: Commit**

```bash
git add components/hub/HubNav.tsx components/hub/ExpertFeedbackTab.tsx "app/expert-feedback/page.tsx"
git commit -m "feat(hub): Expert Feedback tab"
```

---

## Task 9: Full verification

**Files:** none.

- [ ] **Step 1:** Run `npm test && npm run typecheck` → all pass, no type errors.

---

## Controller / rollout steps (not code tasks)

1. Apply migration `0042` to the live DB (Supabase MCP `apply_migration`).
2. Run `npm run setup:expert-feedback` to add the **Feedback type** select to the Dev feedback DB.
3. Deploy (merge to main). Organizer builds the Notion view.

---

## Self-Review

**Spec coverage:**
- General field in the per-1:1 modal → Task 3. ✓
- Separate `expert_general_feedback` (event+expert), Note reused, no `general_feedback` column on expert_feedback → Tasks 1–2, 4. ✓
- Feedback type select (Guest on per-1:1, General on general) → Tasks 5–6. ✓
- One-way race-safe Notion sync for general → Task 6. ✓
- New read-only Expert Feedback hub tab (Guest + General) → Tasks 7–8. ✓
- Config script adds the property; controller applies migration → Task 5 + rollout. ✓

**Placeholder scan:** none. (The Task 4 note about ordering vs Task 6 is guidance; both commit together in Task 6's step 5.)

**Type consistency:** `EF.feedbackType` (Task 5) is used by both `expertFeedbackProperties` (Guest) and `generalFeedbackProperties` (General, Task 6). `feedback_submit.general` (Task 3) flows to `upsertGeneralFeedback` (Task 2) via the route (Task 4), and `pushGeneralFeedback(eventId, expertEmail)` (Task 6) reads it back. `ExpertFeedbackListRow` (Task 7) is consumed by `ExpertFeedbackTab` (Task 8). Consistent.
