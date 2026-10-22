# Per-city comms flow — SP1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only per-city page that shows the guest/expert email flow (what *can* send, with timing/triggers and a template preview) and a city-scoped sent log (what *did* send), backed by a canonical city registry.

**Architecture:** A `cities` registry table + a pure `cityForEvent` resolver map events (free-text city / calendar) to a canonical city. A declarative flow-node catalog (`lib/comms/flow.ts`) describes the guest + expert journeys and maps each node to real `CommsKind`s. A Next.js App-Router page `/cities/[slug]` renders the flow (client toggle + node→template preview via the existing `renderTemplate`) and a sent-log tab (scoped `email_log`). No send-path changes.

**Tech Stack:** Next.js (App Router, server components), Supabase (Postgres via `getAdminClient`), TypeScript, Vitest. Migrations applied via the Supabase MCP (`apply_migration`) and mirrored into `supabase/migrations/`.

**Spec:** `docs/superpowers/specs/2026-10-21-per-city-comms-flow-sp1-design.md`

**Conventions (match existing code):**
- Hub pages are server components with `export const dynamic = "force-dynamic"` and `<HubNav />`; access is gated by `middleware.ts`.
- DB access goes through `getAdminClient()` from `@/lib/supabase/admin`.
- Tests live in `tests/*.test.ts`, run with `npx vitest run tests/<file>`.
- Migrations: number the mirror file past the local max (current max `0063`), apply to remote via MCP `apply_migration`, keep the `.sql` mirror in `supabase/migrations/`.

---

## Task 1: Cities registry — migration + types + seed

**Files:**
- Create: `supabase/migrations/0064_cities.sql`
- Modify: `lib/supabase/types.ts` (add `cities` table type)

- [ ] **Step 1: Apply the migration to remote via MCP**

Use the Supabase MCP tool `apply_migration` with name `cities` and this SQL:

```sql
create table if not exists public.cities (
  slug text primary key,
  name text not null,
  locale text not null default 'en',
  luma_calendar text,
  aliases text[] not null default '{}'
);
alter table public.cities enable row level security; -- deny-all (service-role only), like luma_calendars

insert into public.cities (slug, name, locale, luma_calendar, aliases) values
  ('seoul',     'Seoul',         'ko', 'korea',         '{}'),
  ('sydney',    'Sydney',        'en', 'sydney',        '{"Chippendale","Ultimo"}'),
  ('singapore', 'Singapore',     'en', 'singapore',     '{}'),
  ('london',    'London',        'en', 'london',        '{}'),
  ('nyc',       'New York',      'en', 'notion-master', '{"NYC"}'),
  ('sf',        'San Francisco', 'en', 'notion-master', '{"SF"}')
on conflict (slug) do nothing;
```

- [ ] **Step 2: Mirror the migration file**

Create `supabase/migrations/0064_cities.sql` with a header comment then the exact SQL above:

```sql
-- Canonical city registry for per-city comms customization (SP1). Maps messy
-- free-text events.city + the luma_calendar tag to a stable city slug + locale.
-- Applied to remote via mcp apply_migration on 2026-10-21 (see list_migrations).
<exact SQL from Step 1>
```

- [ ] **Step 3: Verify the rows exist**

Use MCP `execute_sql`: `select slug, name, locale, luma_calendar, aliases from public.cities order by slug;`
Expected: 6 rows (london, nyc, seoul, sf, singapore, sydney).

- [ ] **Step 4: Add the `cities` type to `lib/supabase/types.ts`**

Inside `Database["public"]["Tables"]`, add (alphabetically near the top, matching the generated style):

```ts
      cities: {
        Row: {
          aliases: string[]
          locale: string
          luma_calendar: string | null
          name: string
          slug: string
        }
        Insert: {
          aliases?: string[]
          locale?: string
          luma_calendar?: string | null
          name: string
          slug: string
        }
        Update: {
          aliases?: string[]
          locale?: string
          luma_calendar?: string | null
          name?: string
          slug?: string
        }
        Relationships: []
      }
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0064_cities.sql lib/supabase/types.ts
git commit -m "feat(cities): canonical city registry table + seed (SP1)"
```

---

## Task 2: `cityForEvent` resolver (pure, TDD)

**Files:**
- Create: `lib/comms/city.ts`
- Test: `tests/city-resolver.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { cityForEvent, type CityRow } from "../lib/comms/city";

const CITIES: CityRow[] = [
  { slug: "seoul", name: "Seoul", locale: "ko", luma_calendar: "korea", aliases: [] },
  { slug: "sydney", name: "Sydney", locale: "en", luma_calendar: "sydney", aliases: ["Chippendale", "Ultimo"] },
  { slug: "singapore", name: "Singapore", locale: "en", luma_calendar: "singapore", aliases: [] },
  { slug: "nyc", name: "New York", locale: "en", luma_calendar: "notion-master", aliases: ["NYC"] },
  { slug: "sf", name: "San Francisco", locale: "en", luma_calendar: "notion-master", aliases: ["SF"] },
];

describe("cityForEvent", () => {
  it("matches by name, case-insensitive", () => {
    expect(cityForEvent({ city: "Seoul", luma_calendar: "korea" }, CITIES)).toBe("seoul");
    expect(cityForEvent({ city: "seoul", luma_calendar: "korea" }, CITIES)).toBe("seoul");
    expect(cityForEvent({ city: "New York", luma_calendar: "notion-master" }, CITIES)).toBe("nyc");
  });
  it("matches by alias", () => {
    expect(cityForEvent({ city: "Chippendale", luma_calendar: "sydney" }, CITIES)).toBe("sydney");
  });
  it("falls back to a calendar that uniquely identifies one city", () => {
    expect(cityForEvent({ city: "Somewhere", luma_calendar: "singapore" }, CITIES)).toBe("singapore");
  });
  it("returns null when name/alias miss and the calendar is ambiguous", () => {
    expect(cityForEvent({ city: "Austin", luma_calendar: "notion-master" }, CITIES)).toBeNull();
  });
  it("returns null for an empty city and unknown calendar", () => {
    expect(cityForEvent({ city: "", luma_calendar: "zzz" }, CITIES)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/city-resolver.test.ts`
Expected: FAIL (cannot find module `../lib/comms/city`).

- [ ] **Step 3: Implement `lib/comms/city.ts`**

```ts
export interface CityRow {
  slug: string;
  name: string;
  locale: string;
  luma_calendar: string | null;
  aliases: string[];
}

/** Resolve an event to a canonical city slug, or null. Order: exact name match,
 * then alias match (both case-insensitive), then a calendar that belongs to
 * exactly one city (unique → unambiguous; shared like notion-master → null). */
export function cityForEvent(
  event: { city: string | null; luma_calendar: string | null },
  cities: CityRow[],
): string | null {
  const city = (event.city ?? "").trim().toLowerCase();
  if (city) {
    const byName = cities.find((c) => c.name.trim().toLowerCase() === city);
    if (byName) return byName.slug;
    const byAlias = cities.find((c) => c.aliases.some((a) => a.trim().toLowerCase() === city));
    if (byAlias) return byAlias.slug;
  }
  const cal = (event.luma_calendar ?? "").trim();
  if (cal) {
    const onCal = cities.filter((c) => (c.luma_calendar ?? "") === cal);
    if (onCal.length === 1) return onCal[0].slug;
  }
  return null;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/city-resolver.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/comms/city.ts tests/city-resolver.test.ts
git commit -m "feat(cities): cityForEvent resolver (name/alias/calendar)"
```

---

## Task 3: Cities DB access

**Files:**
- Create: `lib/db/cities.ts`

- [ ] **Step 1: Implement the accessors**

```ts
import { getAdminClient } from "../supabase/admin";
import type { CityRow } from "../comms/city";

/** All registry cities, ordered by name. */
export async function listCities(): Promise<CityRow[]> {
  const { data, error } = await getAdminClient()
    .from("cities")
    .select("slug,name,locale,luma_calendar,aliases")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CityRow[];
}

/** One city by slug, or null. */
export async function getCityBySlug(slug: string): Promise<CityRow | null> {
  const { data, error } = await getAdminClient()
    .from("cities")
    .select("slug,name,locale,luma_calendar,aliases")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return (data as CityRow) ?? null;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/db/cities.ts
git commit -m "feat(cities): listCities + getCityBySlug accessors"
```

---

## Task 4: Expose `COMMS_KINDS` as a runtime array

Needed so the flow catalog can be validated against the real kind list at test time. Deriving the type from a const array keeps the exact same union — no downstream type changes.

**Files:**
- Modify: `lib/email/templates.ts:1` (the `CommsKind` definition)

- [ ] **Step 1: Replace the `CommsKind` type union with a const-array derivation**

Replace line 1 of `lib/email/templates.ts`:

```ts
export type CommsKind = "assigned" | "checked_in" | ... | "reapproved";
```

with (keep the exact same list of strings, in the same order, including `day_of_guest`):

```ts
export const COMMS_KINDS = [
  "assigned", "checked_in", "no_show", "cancelled", "expert_unavailable", "declined",
  "waitlisted", "event_cancelled", "arrived_after_no_show", "double_booked",
  "feedback_request", "feedback_reminder", "prep_reminder", "rematch_pending",
  "unmatched_notice", "reassigned_off", "already_claimed", "day_of_agenda", "day_of_guest",
  "unclaim_denied", "slot_changed", "prep_reminder_day_before", "cowork_only",
  "cowork_only_accept", "guest_cancelled", "prep_reminder_day_before_paid", "reapproved",
] as const;
export type CommsKind = (typeof COMMS_KINDS)[number];
```

- [ ] **Step 2: Typecheck (the union is identical, so nothing else should break)**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add lib/email/templates.ts
git commit -m "refactor(comms): expose COMMS_KINDS runtime array; derive CommsKind from it"
```

---

## Task 5: Template preview helper (TDD)

Returns a node's email **template** (subject + body with `{{tokens}}` intact) for the Flow preview. `renderTemplate(content, {})` leaves tokens literal because `substitute` keeps unknown keys.

**Files:**
- Modify: `lib/email/templates.ts` (add `previewTemplateFor` near `renderComms`)
- Test: `tests/template-preview.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { previewTemplateFor } from "../lib/email/templates";

describe("previewTemplateFor", () => {
  it("returns subject + token-bearing html for a simple kind/role", () => {
    const p = previewTemplateFor("assigned", "guest");
    expect(p).not.toBeNull();
    expect(p!.subject).toContain("Invitation");
    expect(p!.html).toContain("{{expertName}}"); // tokens stay literal in a template preview
    expect(p!.label).toBeTruthy();
  });
  it("resolves a context-variant guest kind to a base variant", () => {
    const p = previewTemplateFor("checked_in", "guest");
    expect(p).not.toBeNull();
    expect(p!.subject.length).toBeGreaterThan(0);
  });
  it("returns null when no template exists for the pair", () => {
    expect(previewTemplateFor("no_show", "guest")).toBeNull(); // no_show is helper-only
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/template-preview.test.ts`
Expected: FAIL (`previewTemplateFor` is not exported).

- [ ] **Step 3: Implement `previewTemplateFor` in `lib/email/templates.ts`**

Add after `renderComms` (around line 745):

```ts
/** The email TEMPLATE for a (kind, role) — subject + html with {{tokens}} left
 * intact — for the read-only flow preview. Context-variant guest kinds resolve to
 * their base variant. Returns null when no template exists for the pair. */
export function previewTemplateFor(
  kind: CommsKind,
  role: Recipient,
  overrides?: OverrideMap,
): { subject: string; html: string; label: string } | null {
  const candidates: TemplateKey[] =
    kind === "checked_in" && role === "guest"
      ? ["checked_in__guest__matched"]
      : kind === "arrived_after_no_show" && role === "guest"
        ? ["arrived_after_no_show__guest__matched"]
        : [`${kind}__${role}` as TemplateKey];
  const key = candidates.find((k) => k in TEMPLATE_REGISTRY);
  if (!key) return null;
  const def = TEMPLATE_REGISTRY[key];
  const ov = overrides?.get(key);
  const content = { subject: ov?.subject ?? def.subject, body: ov?.body ?? def.body };
  const { subject, html } = renderTemplate(content, {}); // empty vars → tokens stay literal
  return { subject, html, label: def.label };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/template-preview.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/email/templates.ts tests/template-preview.test.ts
git commit -m "feat(comms): previewTemplateFor — template preview with tokens intact"
```

---

## Task 6: Flow-node catalog + integrity test (TDD)

**Files:**
- Create: `lib/comms/flow.ts`
- Test: `tests/comms-flow.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { FLOW_NODES } from "../lib/comms/flow";
import { COMMS_KINDS } from "../lib/email/templates";

describe("FLOW_NODES", () => {
  it("every node references only real CommsKinds", () => {
    const valid = new Set<string>(COMMS_KINDS);
    for (const n of FLOW_NODES) for (const k of n.commsKinds) expect(valid.has(k)).toBe(true);
  });
  it("covers both audiences", () => {
    expect(FLOW_NODES.some((n) => n.audience === "guest")).toBe(true);
    expect(FLOW_NODES.some((n) => n.audience === "expert")).toBe(true);
  });
  it("has unique node ids", () => {
    const ids = FLOW_NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("schedule triggers carry a rule; event triggers do not", () => {
    for (const n of FLOW_NODES) {
      if (n.trigger.kind === "schedule") expect(n.trigger.rule).toBeTruthy();
      else expect("rule" in n.trigger).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/comms-flow.test.ts`
Expected: FAIL (cannot find `../lib/comms/flow`).

- [ ] **Step 3: Implement `lib/comms/flow.ts`**

```ts
import type { CommsKind, Recipient } from "../email/templates";

export type Audience = "guest" | "expert";
export type Phase = "before" | "matching_dayof" | "after" | "exception";
export type Trigger =
  | { kind: "schedule"; label: string; rule: { offsetDays: number; targetHour: number } }
  | { kind: "event"; label: string };

export interface FlowNode {
  id: string;
  audience: Audience;
  phase: Phase;
  label: string;
  detail?: string;
  commsKinds: CommsKind[];
  trigger: Trigger;
  recipientRole: Recipient;
}

const sched = (label: string, offsetDays: number, targetHour = 9): Trigger => ({ kind: "schedule", label, rule: { offsetDays, targetHour } });
const ev = (label: string): Trigger => ({ kind: "event", label });

export const FLOW_NODES: FlowNode[] = [
  // ---- GUEST ----
  { id: "g-prep", audience: "guest", phase: "before", label: "Prep — activate Notion AI / claim credits", commsKinds: ["prep_reminder"], trigger: sched("T−3d · 9am", -3), recipientRole: "guest" },
  { id: "g-daybefore", audience: "guest", phase: "before", label: "Tomorrow: your 1:1 + credits + logistics", detail: "merged day-before (slot + expert + credits + logistics)", commsKinds: ["prep_reminder_day_before", "prep_reminder_day_before_paid"], trigger: sched("T−1d · 9am", -1), recipientRole: "guest" },
  { id: "g-status", audience: "guest", phase: "before", label: "Waitlisted / Declined / Spot opened", commsKinds: ["waitlisted", "declined", "reapproved"], trigger: ev("on Luma status change"), recipientRole: "guest" },
  { id: "g-cowork", audience: "guest", phase: "before", label: "Cowork-only / unmatched notice", commsKinds: ["cowork_only", "rematch_pending", "unmatched_notice"], trigger: sched("day before", -1), recipientRole: "guest" },
  { id: "g-confirmed", audience: "guest", phase: "matching_dayof", label: "1:1 confirmed + calendar invite", detail: "expert clicks Claim OR the DRI sets \"Booked by\" in Notion → auto-approved in Luma", commsKinds: ["assigned"], trigger: ev("on claim / DRI assign"), recipientRole: "guest" },
  { id: "g-slotchanged", audience: "guest", phase: "matching_dayof", label: "Slot changed — new time + updated invite", detail: "manual Notion slot edit, or guest self-serve change-slot form", commsKinds: ["slot_changed"], trigger: ev("on slot edit"), recipientRole: "guest" },
  { id: "g-coworkaccept", audience: "guest", phase: "matching_dayof", label: "Cowork-only accepted", commsKinds: ["cowork_only_accept"], trigger: ev("organizer accepts for coworking"), recipientRole: "guest" },
  { id: "g-welcome", audience: "guest", phase: "matching_dayof", label: "Welcome (checked in)", commsKinds: ["checked_in", "arrived_after_no_show"], trigger: ev("at the door"), recipientRole: "guest" },
  { id: "g-feedback", audience: "guest", phase: "after", label: "Feedback request → reminder +2d", commsKinds: ["feedback_request", "feedback_reminder"], trigger: ev("event ends · T+2d"), recipientRole: "guest" },
  { id: "g-cancelled", audience: "guest", phase: "exception", label: "Cancelled / event cancelled", commsKinds: ["cancelled", "event_cancelled"], trigger: ev("cancellation"), recipientRole: "guest" },
  // ---- EXPERT ----
  { id: "e-assigned", audience: "expert", phase: "matching_dayof", label: "Assigned — you're helping {{guestName}} + invite", detail: "they click Claim OR the DRI assigns them in Notion · Slack DM too", commsKinds: ["assigned"], trigger: ev("on claim / DRI assign"), recipientRole: "helper" },
  { id: "e-agenda", audience: "expert", phase: "matching_dayof", label: "Day-of agenda — your 1:1 lineup", commsKinds: ["day_of_agenda"], trigger: sched("day-of · 9am", 0), recipientRole: "helper" },
  { id: "e-checkedin", audience: "expert", phase: "matching_dayof", label: "Your guest checked in", commsKinds: ["checked_in"], trigger: ev("at the door"), recipientRole: "helper" },
  { id: "e-noshow", audience: "expert", phase: "matching_dayof", label: "Guest no-show / arrived after", commsKinds: ["no_show", "arrived_after_no_show"], trigger: ev("slot +5m / late"), recipientRole: "helper" },
  { id: "e-slotchanged", audience: "expert", phase: "exception", label: "Slot changed / reassigned off / removed", commsKinds: ["slot_changed", "reassigned_off", "expert_unavailable"], trigger: ev("reassign / unclaim / slot edit"), recipientRole: "helper" },
  { id: "e-guestcancel", audience: "expert", phase: "exception", label: "Guest cancelled / double-booked / already-claimed / unclaim-denied", commsKinds: ["guest_cancelled", "double_booked", "already_claimed", "unclaim_denied"], trigger: ev("conflict / cancel"), recipientRole: "helper" },
];

/** Phases in display order. */
export const FLOW_PHASES: { id: Phase; label: string }[] = [
  { id: "before", label: "Before the event" },
  { id: "matching_dayof", label: "Matching & day of" },
  { id: "after", label: "After" },
  { id: "exception", label: "Exceptions" },
];

export function nodesFor(audience: Audience): FlowNode[] {
  return FLOW_NODES.filter((n) => n.audience === audience);
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/comms-flow.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/comms/flow.ts tests/comms-flow.test.ts
git commit -m "feat(comms): declarative guest/expert flow-node catalog"
```

---

## Task 7: City-scoped sent log — pure helpers (TDD) + query

**Files:**
- Create: `lib/comms/log.ts` (pure helpers)
- Modify: `lib/db/cities.ts` (add `listCitySentLog`)
- Test: `tests/city-log.test.ts`

- [ ] **Step 1: Write the failing test for the pure helpers**

```ts
import { describe, it, expect } from "vitest";
import { logCategory, toSentLogRows } from "../lib/comms/log";

describe("logCategory", () => {
  it("prefixes with audience and names the kind", () => {
    expect(logCategory("assigned", "guest")).toBe("GUEST · assigned");
    expect(logCategory("day_of_agenda", "helper")).toBe("EXPERT · day_of_agenda");
  });
});

describe("toSentLogRows", () => {
  it("joins email_log to guest names and sorts newest-first", () => {
    const rows = toSentLogRows(
      [
        { booking_id: "b1", event_kind: "assigned", recipient_role: "guest", recipient_email: "a@x.com", status: "sent", created_at: "2026-10-28T03:00:00Z" },
        { booking_id: "b2", event_kind: "day_of_agenda", recipient_role: "helper", recipient_email: "e@x.com", status: "failed", created_at: "2026-10-30T00:00:00Z" },
      ],
      new Map([["b1", "Sanghyun Lee"], ["b2", "Minji Kim"]]),
    );
    expect(rows.map((r) => r.guestName)).toEqual(["Minji Kim", "Sanghyun Lee"]); // newest first
    expect(rows[1].category).toBe("GUEST · assigned");
    expect(rows[0].status).toBe("failed");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/city-log.test.ts`
Expected: FAIL (cannot find `../lib/comms/log`).

- [ ] **Step 3: Implement `lib/comms/log.ts`**

```ts
import type { CommsKind, Recipient } from "../email/templates";

export interface RawLogRow {
  booking_id: string;
  event_kind: string;
  recipient_role: string;
  recipient_email: string | null;
  status: string;
  created_at: string;
}
export interface SentLogRow {
  when: string;
  category: string;
  kind: string;
  role: string;
  guestName: string | null;
  recipientEmail: string | null;
  status: string;
}

/** "GUEST · assigned" / "EXPERT · day_of_agenda". */
export function logCategory(kind: CommsKind | string, role: Recipient | string): string {
  return `${role === "helper" ? "EXPERT" : "GUEST"} · ${kind}`;
}

/** Join raw email_log rows to guest names (by booking id) → display rows, newest first. */
export function toSentLogRows(raw: RawLogRow[], guestByBooking: Map<string, string | null>): SentLogRow[] {
  return raw
    .map((r) => ({
      when: r.created_at,
      category: logCategory(r.event_kind, r.recipient_role),
      kind: r.event_kind,
      role: r.recipient_role,
      guestName: guestByBooking.get(r.booking_id) ?? null,
      recipientEmail: r.recipient_email,
      status: r.status,
    }))
    .sort((a, b) => b.when.localeCompare(a.when));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/city-log.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `listCitySentLog` to `lib/db/cities.ts`**

Append (imports at top: `import { cityForEvent } from "../comms/city"; import { toSentLogRows, type RawLogRow, type SentLogRow } from "../comms/log"; import { listCities } from "./cities";` — note `listCities` is in the same file, so call it directly, don't re-import):

```ts
/** Emails actually sent for a city's events (newest first). Resolves city → events
 * → bookings → email_log, then joins guest names. Read-only. */
export async function listCitySentLog(slug: string, limit = 200): Promise<SentLogRow[]> {
  const supabase = getAdminClient();
  const cities = await listCities();
  const { data: events } = await supabase.from("events").select("id,city,luma_calendar");
  const eventIds = (events ?? []).filter((e) => cityForEvent(e as { city: string | null; luma_calendar: string | null }, cities) === slug).map((e) => e.id as string);
  if (eventIds.length === 0) return [];

  const { data: bookings } = await supabase.from("booking_details").select("id,guest_name,event_id").in("event_id", eventIds);
  const bookingIds = (bookings ?? []).map((b) => b.id as string);
  const guestByBooking = new Map<string, string | null>();
  for (const b of bookings ?? []) guestByBooking.set(b.id as string, (b.guest_name as string) ?? null);
  if (bookingIds.length === 0) return [];

  // email_log isn't in the generated types; access loosely (same as lib/db/email-log.ts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: logs } = await (supabase as any)
    .from("email_log")
    .select("booking_id,event_kind,recipient_role,recipient_email,status,created_at")
    .in("booking_id", bookingIds)
    .order("created_at", { ascending: false })
    .limit(limit);
  return toSentLogRows((logs ?? []) as RawLogRow[], guestByBooking);
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add lib/comms/log.ts lib/db/cities.ts tests/city-log.test.ts
git commit -m "feat(cities): city-scoped sent log (pure helpers + query)"
```

---

## Task 8: Cities index page + HubNav link

**Files:**
- Create: `app/cities/page.tsx`
- Modify: `components/hub/HubNav.tsx:6-13` (TABS array)

- [ ] **Step 1: Add the Cities tab to `HubNav`**

In `components/hub/HubNav.tsx`, add to the `TABS` array after the `Feedback`/`Expert Feedback` entries:

```ts
  { href: "/cities", label: "Cities" },
```

- [ ] **Step 2: Create `app/cities/page.tsx`**

```tsx
import Link from "next/link";
import { listCities } from "@/lib/db/cities";
import { HubNav } from "@/components/hub/HubNav";

export const dynamic = "force-dynamic";

export default async function CitiesIndexPage() {
  const cities = await listCities();
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <HubNav />
      <p className="mb-5 max-w-2xl text-sm text-neutral-500">
        The comms flow + sent log, per city. Pick a city to see every email a guest or expert could receive, and what has actually gone out.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cities.map((c) => (
          <Link key={c.slug} href={`/cities/${c.slug}`} className="rounded-xl border border-line bg-white p-4 hover:bg-neutral-50">
            <div className="font-medium">{c.name}</div>
            <div className="mt-1 text-xs text-neutral-500">locale: {c.locale}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verify it builds + renders**

Run: `npx tsc --noEmit` (expect exit 0). Then `npm run dev`, log into the hub, visit `/cities`.
Expected: a grid of 6 city cards; "Cities" appears in the hub nav.

- [ ] **Step 4: Commit**

```bash
git add app/cities/page.tsx components/hub/HubNav.tsx
git commit -m "feat(cities): cities index page + hub nav link"
```

---

## Task 9: Per-city page shell with Flow / Sent-log tabs

**Files:**
- Create: `app/cities/[slug]/page.tsx`
- Create: `components/hub/CityTabs.tsx`

- [ ] **Step 1: Create the server page `app/cities/[slug]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { getCityBySlug } from "@/lib/db/cities";
import { listCitySentLog } from "@/lib/db/cities";
import { HubNav } from "@/components/hub/HubNav";
import { CityTabs } from "@/components/hub/CityTabs";

export const dynamic = "force-dynamic";

export default async function CityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const city = await getCityBySlug(slug);
  if (!city) notFound();
  const sentLog = await listCitySentLog(slug);
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <HubNav />
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-xl font-bold">{city.name}</h2>
        <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs text-violet-700">locale: {city.locale}</span>
      </div>
      <CityTabs sentLog={sentLog} />
    </main>
  );
}
```

- [ ] **Step 2: Create the client tab switcher `components/hub/CityTabs.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { SentLogRow } from "@/lib/comms/log";
import { CityFlow } from "./CityFlow";
import { CitySentLog } from "./CitySentLog";

export function CityTabs({ sentLog }: { sentLog: SentLogRow[] }) {
  const [tab, setTab] = useState<"flow" | "log">("flow");
  const Tab = ({ id, label }: { id: "flow" | "log"; label: string }) => (
    <button
      onClick={() => setTab(id)}
      className={`border-b-2 px-4 py-2 text-sm ${tab === id ? "border-neutral-900 font-semibold" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}
    >
      {label}
    </button>
  );
  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-line">
        <Tab id="flow" label="Flow" />
        <Tab id="log" label={`Sent log · ${sentLog.length}`} />
        <span className="border-b-2 border-transparent px-4 py-2 text-sm text-neutral-300">Localization (later)</span>
      </div>
      {tab === "flow" ? <CityFlow /> : <CitySentLog rows={sentLog} />}
    </div>
  );
}
```

- [ ] **Step 3: Add temporary stubs so the page compiles**

Create `components/hub/CityFlow.tsx`:

```tsx
export function CityFlow() {
  return <div className="text-sm text-neutral-400">Flow — Task 10</div>;
}
```

Create `components/hub/CitySentLog.tsx`:

```tsx
import type { SentLogRow } from "@/lib/comms/log";
export function CitySentLog({ rows }: { rows: SentLogRow[] }) {
  return <div className="text-sm text-neutral-400">Sent log — {rows.length} rows — Task 11</div>;
}
```

- [ ] **Step 4: Verify the page renders with working tabs**

Run: `npx tsc --noEmit` (exit 0). In `npm run dev`, visit `/cities/seoul`.
Expected: city header with locale badge; Flow/Sent-log tabs switch; stub content shows; an unknown slug (`/cities/zzz`) 404s.

- [ ] **Step 5: Commit**

```bash
git add "app/cities/[slug]/page.tsx" components/hub/CityTabs.tsx components/hub/CityFlow.tsx components/hub/CitySentLog.tsx
git commit -m "feat(cities): per-city page shell with Flow/Sent-log tabs"
```

---

## Task 10: CityFlow — guest/expert toggle, journey, node→template preview

**Files:**
- Modify: `components/hub/CityFlow.tsx` (replace the stub)
- Create: `app/api/hub/flow-preview/route.ts` (server renders a node's template)

Rationale: `previewTemplateFor` uses server-only template code, so the client fetches the rendered template from a small auth-gated route on node click.

- [ ] **Step 1: Create the preview API route `app/api/hub/flow-preview/route.ts`**

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { previewTemplateFor, type CommsKind, type Recipient } from "@/lib/email/templates";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const secret = process.env.HUB_SESSION_SECRET;
  if (!secret || !(await isValidSession((await cookies()).get(SESSION_COOKIE)?.value, secret))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") as CommsKind | null;
  const role = (url.searchParams.get("role") as Recipient | null) ?? "guest";
  if (!kind) return NextResponse.json({ error: "kind required" }, { status: 400 });
  const preview = previewTemplateFor(kind, role);
  if (!preview) return NextResponse.json({ error: "no template" }, { status: 404 });
  return NextResponse.json(preview);
}
```

(If `CommsKind`/`Recipient` aren't re-exported where expected, import them from `@/lib/email/templates` — they are exported there.)

- [ ] **Step 2: Replace `components/hub/CityFlow.tsx` with the interactive flow**

```tsx
"use client";

import { useState } from "react";
import { nodesFor, FLOW_PHASES, type Audience, type FlowNode } from "@/lib/comms/flow";

function Pill({ t }: { t: FlowNode["trigger"] }) {
  const scheduled = t.kind === "schedule";
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${scheduled ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>
      {t.label}
    </span>
  );
}

export function CityFlow() {
  const [audience, setAudience] = useState<Audience>("guest");
  const [selected, setSelected] = useState<FlowNode | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string; label: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function pick(node: FlowNode) {
    setSelected(node);
    setPreview(null);
    setLoading(true);
    const res = await fetch(`/api/hub/flow-preview?kind=${node.commsKinds[0]}&role=${node.recipientRole}`);
    setPreview(res.ok ? await res.json() : null);
    setLoading(false);
  }

  const nodes = nodesFor(audience);
  return (
    <div className="flex gap-4">
      <div className="flex-1">
        <div className="mb-4 inline-flex overflow-hidden rounded-full border border-line text-sm">
          {(["guest", "expert"] as Audience[]).map((a) => (
            <button key={a} onClick={() => { setAudience(a); setSelected(null); setPreview(null); }}
              className={`px-4 py-1 ${audience === a ? "bg-neutral-900 text-white" : "text-neutral-600"}`}>
              {a === "guest" ? "Guest" : "Expert"}
            </button>
          ))}
        </div>
        {FLOW_PHASES.filter((p) => nodes.some((n) => n.phase === p.id)).map((p) => (
          <div key={p.id} className="mb-5">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-amber-700/70">{p.label}</div>
            <div className="flex flex-col gap-2">
              {nodes.filter((n) => n.phase === p.id).map((n) => (
                <button key={n.id} onClick={() => pick(n)}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm ${selected?.id === n.id ? "border-green-600 bg-green-50/40" : "border-line bg-white hover:bg-neutral-50"}`}>
                  <Pill t={n.trigger} />
                  <span className="flex-1">
                    <span className="text-neutral-400">○ ✉ </span>{n.label}
                    {n.detail ? <span className="mt-0.5 block text-[11px] text-neutral-500">{n.detail}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="w-[360px] shrink-0">
        {selected ? (
          <div className="sticky top-3 overflow-hidden rounded-xl border border-line bg-white">
            <div className="border-b border-line bg-green-50/60 px-4 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-green-700">Template — what this email says</div>
              <div className="mt-1 text-sm font-semibold">{preview?.label ?? selected.label}</div>
              <div className="mt-0.5 text-[11px] text-neutral-500">trigger: {selected.trigger.label} · to {selected.recipientRole === "helper" ? "Expert" : "Guest"}</div>
            </div>
            <div className="px-4 py-3 text-sm">
              {loading ? <div className="text-neutral-400">Loading…</div> : preview ? (
                <>
                  <div className="text-[10px] uppercase text-neutral-400">Subject</div>
                  <div className="mb-3">{preview.subject}</div>
                  <div className="text-[10px] uppercase text-neutral-400">Body</div>
                  <div className="prose prose-sm mt-1 max-w-none" dangerouslySetInnerHTML={{ __html: preview.html }} />
                </>
              ) : <div className="text-neutral-400">No template for this node.</div>}
            </div>
            <div className="border-t border-line bg-neutral-50 px-4 py-2 text-[11px] text-neutral-400">
              shows {`{{tokens}}`} — the template, not a specific send · edit/translate = SP2/SP3
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-neutral-400">Click an email to preview its template.</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify the flow renders and previews**

Run: `npx tsc --noEmit` (exit 0). In `npm run dev`, visit `/cities/seoul`, Flow tab:
Expected: Guest/Expert toggle switches the journey; phases group the nodes; each node shows its timing/trigger pill; clicking a node loads its template (subject + body with `{{tokens}}` visible) in the right panel; toggling to Expert shows the expert nodes.

- [ ] **Step 4: Commit**

```bash
git add components/hub/CityFlow.tsx app/api/hub/flow-preview/route.ts
git commit -m "feat(cities): CityFlow — toggle, journey, node→template preview"
```

---

## Task 11: CitySentLog — categorized log + click-to-view actual email

**Files:**
- Modify: `components/hub/CitySentLog.tsx` (replace the stub)
- Create: `app/api/hub/sent-email/route.ts` (returns a specific sent email's rendered content)

Note: a faithful "exact bytes as sent" view would require persisting the sent HTML. SP1 re-renders the template for `(kind, role)` via `previewTemplateFor` and shows it alongside the real recipient/time/status from the log row — the content is the template, the envelope is real. (Persisting exact sent HTML is an SP2+ enhancement; call it out, don't fake it.)

- [ ] **Step 1: Create `app/api/hub/sent-email/route.ts`**

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { previewTemplateFor, type CommsKind, type Recipient } from "@/lib/email/templates";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const secret = process.env.HUB_SESSION_SECRET;
  if (!secret || !(await isValidSession((await cookies()).get(SESSION_COOKIE)?.value, secret))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") as CommsKind | null;
  const role = (url.searchParams.get("role") as Recipient | null) ?? "guest";
  if (!kind) return NextResponse.json({ error: "kind required" }, { status: 400 });
  const preview = previewTemplateFor(kind, role);
  if (!preview) return NextResponse.json({ error: "no template" }, { status: 404 });
  return NextResponse.json(preview);
}
```

- [ ] **Step 2: Replace `components/hub/CitySentLog.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { SentLogRow } from "@/lib/comms/log";

const statusClass: Record<string, string> = {
  sent: "bg-green-50 text-green-700",
  failed: "bg-red-50 text-red-700",
  skipped: "bg-neutral-100 text-neutral-500",
  pending: "bg-amber-50 text-amber-700",
};

export function CitySentLog({ rows }: { rows: SentLogRow[] }) {
  const [filter, setFilter] = useState<"all" | "guest" | "expert" | "failed">("all");
  const [open, setOpen] = useState<number | null>(null);
  const [content, setContent] = useState<{ subject: string; html: string } | null>(null);

  const shown = rows.filter((r) =>
    filter === "all" ? true : filter === "failed" ? r.status === "failed" : filter === "guest" ? r.role === "guest" : r.role === "helper",
  );

  async function toggle(i: number, r: SentLogRow) {
    if (open === i) { setOpen(null); return; }
    setOpen(i); setContent(null);
    const res = await fetch(`/api/hub/sent-email?kind=${r.kind}&role=${r.role}`);
    setContent(res.ok ? await res.json() : null);
  }

  if (!rows.length) return <div className="rounded-xl border border-line p-6 text-center text-sm text-neutral-400">No emails sent for this city yet.</div>;

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="flex items-center gap-2 border-b border-line bg-neutral-50 px-4 py-2 text-xs">
        <strong>Sent emails</strong><span className="text-neutral-400">{rows.length} total</span>
        <span className="ml-auto flex gap-1">
          {(["all", "guest", "expert", "failed"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-2.5 py-0.5 ${filter === f ? "bg-neutral-900 text-white" : "border border-line text-neutral-600"}`}>{f}</button>
          ))}
        </span>
      </div>
      <div className="max-h-[520px] overflow-y-auto text-sm">
        {shown.map((r, i) => (
          <div key={i} className="border-b border-line last:border-0">
            <button onClick={() => toggle(i, r)} className="grid w-full grid-cols-[150px_1fr_160px_80px] items-center gap-3 px-4 py-2 text-left hover:bg-neutral-50">
              <span className="text-neutral-500">{new Date(r.when).toLocaleString()}</span>
              <span><span className="mr-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-600">{r.category}</span></span>
              <span className="truncate text-neutral-600">{r.guestName ?? r.recipientEmail ?? "—"}</span>
              <span className={`justify-self-start rounded-full px-2 py-0.5 text-[11px] ${statusClass[r.status] ?? "bg-neutral-100"}`}>{r.status}</span>
            </button>
            {open === i ? (
              <div className="mx-4 mb-3 overflow-hidden rounded-lg border border-line bg-white">
                <div className="border-b border-line bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500">
                  to {r.recipientEmail ?? "—"} · {new Date(r.when).toLocaleString()} · {r.status}
                </div>
                <div className="px-4 py-3 text-sm">
                  {content ? (
                    <>
                      <div className="text-[10px] uppercase text-neutral-400">Subject</div>
                      <div className="mb-2">{content.subject}</div>
                      <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: content.html }} />
                      <div className="mt-2 text-[11px] text-neutral-400">template content shown (exact sent HTML persisted in a later phase)</div>
                    </>
                  ) : <div className="text-neutral-400">Loading…</div>}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify the sent log**

In `npm run dev`, visit `/cities/sydney` (has real sends from this session) → Sent log tab:
Expected: rows categorized (`GUEST · day_of_guest`, etc.), status chips, Guest/Expert/Failed filters work, clicking a row expands the email content with the real recipient/time envelope. `/cities/seoul` shows its own rows.

- [ ] **Step 4: Full typecheck + test + commit**

Run: `npx tsc --noEmit` (exit 0) and `npm test` (all pass).

```bash
git add components/hub/CitySentLog.tsx app/api/hub/sent-email/route.ts
git commit -m "feat(cities): CitySentLog — categorized log + view sent email"
```

---

## Final verification

- [ ] `npx tsc --noEmit` → exit 0
- [ ] `npm test` → all pass (new: city-resolver, template-preview, comms-flow, city-log)
- [ ] Manual: `/cities` lists 6 cities; `/cities/seoul` Flow tab toggles guest/expert, nodes grouped by phase with timing pills, node click previews the template; Sent-log tab categorized + expandable; unknown slug 404s.
- [ ] No non-Build-Bar/hidden regressions elsewhere (dashboards untouched by this plan).

## Notes for SP2 / SP3 (not this plan)

- **SP2:** extend `email_overrides` to `(key, city)`; precedence city > global > default in `renderComms`/`previewTemplateFor` (already accepts an `overrides` arg); wire the Flow preview's "Edit for <city>" action; ●/○ customized dots become real.
- **SP3:** `cities.locale` drives a "translate defaults → <locale>" action that seeds the per-city override drafts.
- **Companion comms change (separate):** merge the −1d email (slot+expert + credits + logistics) and drop the morning-of `day_of_guest`; then update node `g-daybefore` / remove the morning-of mapping. Extends `2026-10-21-per-event-comms-timeline-design.md` Part A.
