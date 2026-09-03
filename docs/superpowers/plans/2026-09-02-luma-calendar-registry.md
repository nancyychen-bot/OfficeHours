# Luma Calendar Registry + Self-Service Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store Luma calendars in Supabase and let a new calendar be onboarded straight from the add-event form (paste the API key with instructions when the calendar is unknown), so no redeploy is needed and events flow into the existing Notion booking mirror automatically.

**Architecture:** A `luma_calendars` table (RLS deny-all, service-role reads — same posture as `slack_channels`) becomes the source of calendar credentials. `lib/luma/calendars.ts` keeps its four function names but reads the table (async, 60s cache) and **merges** any env-defined calendars so nothing breaks during migration. The add-event route gains a progressive branch: when a vanity URL resolves to no connected calendar, it returns `needsCalendar`; the form reveals API-key/webhook/slug fields with grab-it instructions; on resubmit the route validates the key against that exact event via `calendars/events/list`, upserts the calendar row, then registers.

**Tech Stack:** Next.js (App Router, route handlers), TypeScript, Supabase (`@supabase/supabase-js` service-role), Vitest.

**Reference spec:** `docs/superpowers/specs/2026-09-02-luma-calendar-registry-design.md`

**Precedent to mirror:** `slack_channels` — table + `lib/db/slack.ts` data access + `migrations/00xx_*.sql`.

**Prereqs already shipped:** vanity-URL resolution via `calendars/events/list` (`lib/luma/client.ts` `resolveLumaEventId` / `slugFromUrl` / `findEventIdInCalendar`). This plan reuses `slugFromUrl` and the list-pagination shape.

---

## File structure

- Create `migrations/0050_luma_calendars.sql` — table + RLS + `updated_at` trigger.
- Create `lib/db/luma-calendars.ts` — typed data access (list, upsert, delete, getByCalendarId).
- Modify `lib/supabase/types.ts` — regenerated to include `luma_calendars`.
- Modify `lib/luma/calendars.ts` — DB-backed + env-merge + cache; functions become async.
- Modify callers to `await`: `lib/luma/client.ts`, `lib/events/register.ts`, `lib/events/luma-stats.ts`, `lib/events/decline-pending.ts`, `lib/email/comms.ts`, `app/api/webhooks/luma/route.ts`, `app/api/webhooks/notion/[workspace]/route.ts`.
- Create `lib/events/onboard.ts` — `resolveNewCalendarEvent` (validate a pasted key against the event; return evt-id + cal-id + city).
- Modify `lib/luma/client.ts` — export `listUpcomingCalendarEvents(apiKey)` returning `{id, url, calendarId, city}` (used by onboarding).
- Modify `app/api/hub/add-event/route.ts` — progressive `needsCalendar` branch + calendar upsert + `calendarUrl`.
- Modify `components/hub/AddEventForm.tsx` — calendar-URL field + progressive reveal + instructions.
- Tests: `tests/luma-calendars.test.ts`, `tests/onboard.test.ts`, extend `tests/luma-client.test.ts`.

---

# Phase 1 — Registry foundation (no user-visible change; env still works)

### Task 1: `luma_calendars` table migration

**Files:**
- Create: `migrations/0050_luma_calendars.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0050_luma_calendars.sql
-- Luma calendars keyring in the DB (mirrors slack_channels posture):
-- RLS enabled with NO policies → anon/authenticated blocked, service-role bypasses.
create table if not exists public.luma_calendars (
  id             text primary key,          -- slug, also events.luma_calendar (e.g. 'default','sydney','london')
  api_key        text not null,             -- 🔒 service-role only
  webhook_secret text,                      -- 🔒 optional (inbound guest sync)
  calendar_id    text,                       -- Luma 'cal-…' id
  city           text,                       -- default city (seeds slack routing)
  calendar_url   text,                       -- 'follow our calendar' link for guest emails
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.luma_calendars enable row level security;
-- No policies on purpose: only the service-role client (which bypasses RLS) reads/writes.

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_luma_calendars_updated_at on public.luma_calendars;
create trigger trg_luma_calendars_updated_at
  before update on public.luma_calendars
  for each row execute function public.set_updated_at();
```

- [ ] **Step 2: Apply the migration**

Apply with the repo's normal migration process (e.g. `supabase db push`, or the Supabase MCP `apply_migration` with name `0050_luma_calendars` and the SQL above against project `jldgxdaemtdqcfrdzeby`).
Expected: table `public.luma_calendars` exists; `select * from luma_calendars` returns 0 rows.

- [ ] **Step 3: Regenerate DB types**

Regenerate `lib/supabase/types.ts` (Supabase MCP `generate_typescript_types`, or `supabase gen types typescript`). Confirm the file now contains a `luma_calendars` entry under `Tables`.

- [ ] **Step 4: Commit**

```bash
git add migrations/0050_luma_calendars.sql lib/supabase/types.ts
git commit -m "feat(luma): luma_calendars table (RLS deny-all, service-role only)"
```

---

### Task 2: Data-access module `lib/db/luma-calendars.ts`

**Files:**
- Create: `lib/db/luma-calendars.ts`
- Test: `tests/luma-calendars.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/luma-calendars.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { mapCalendarRow } from "@/lib/db/luma-calendars";

afterEach(() => vi.restoreAllMocks());

describe("mapCalendarRow", () => {
  it("maps snake_case DB columns to the camelCase row shape", () => {
    expect(
      mapCalendarRow({
        id: "london", api_key: "secret-x", webhook_secret: null,
        calendar_id: "cal-1", city: "London", calendar_url: "https://luma.com/notion-london",
      }),
    ).toEqual({
      id: "london", apiKey: "secret-x", webhookSecret: null,
      calendarId: "cal-1", city: "London", calendarUrl: "https://luma.com/notion-london",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/luma-calendars.test.ts`
Expected: FAIL — `mapCalendarRow` is not exported.

- [ ] **Step 3: Write the module**

```ts
// lib/db/luma-calendars.ts
import { getAdminClient } from "../supabase/admin";

export interface LumaCalendarRow {
  id: string;
  apiKey: string;
  webhookSecret: string | null;
  calendarId: string | null;
  city: string | null;
  calendarUrl: string | null;
}

interface RawRow {
  id: string;
  api_key: string;
  webhook_secret: string | null;
  calendar_id: string | null;
  city: string | null;
  calendar_url: string | null;
}

/** Pure snake_case → camelCase mapping (unit-tested without a DB). */
export function mapCalendarRow(r: RawRow): LumaCalendarRow {
  return {
    id: r.id,
    apiKey: r.api_key,
    webhookSecret: r.webhook_secret,
    calendarId: r.calendar_id,
    city: r.city,
    calendarUrl: r.calendar_url,
  };
}

const COLS = "id, api_key, webhook_secret, calendar_id, city, calendar_url";

/** All calendar rows. Throws on a DB error so callers can fail loud. */
export async function listLumaCalendarRows(): Promise<LumaCalendarRow[]> {
  const { data, error } = await getAdminClient().from("luma_calendars").select(COLS);
  if (error) throw error;
  return (data ?? []).map((r) => mapCalendarRow(r as RawRow));
}

/** Create or replace a calendar (keyed on id/slug). */
export async function upsertLumaCalendar(input: LumaCalendarRow): Promise<void> {
  const { error } = await getAdminClient().from("luma_calendars").upsert(
    {
      id: input.id,
      api_key: input.apiKey,
      webhook_secret: input.webhookSecret,
      calendar_id: input.calendarId,
      city: input.city,
      calendar_url: input.calendarUrl,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) throw error;
}

/** Find a calendar by its Luma cal- id (used to detect already-connected calendars). */
export async function getLumaCalendarByCalendarId(calendarId: string): Promise<LumaCalendarRow | null> {
  const { data } = await getAdminClient().from("luma_calendars").select(COLS).eq("calendar_id", calendarId).maybeSingle();
  return data ? mapCalendarRow(data as RawRow) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/luma-calendars.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db/luma-calendars.ts tests/luma-calendars.test.ts
git commit -m "feat(luma): luma_calendars data-access module"
```

---

### Task 3: Make `lib/luma/calendars.ts` DB-backed (async + env-merge + cache)

**Files:**
- Modify: `lib/luma/calendars.ts`
- Test: extend `tests/luma-calendars.test.ts`

- [ ] **Step 1: Write the failing test** (append to `tests/luma-calendars.test.ts`)

```ts
import { lumaCalendars, lumaWebhookSecrets, __bustCalendarCache } from "@/lib/luma/calendars";
import * as db from "@/lib/db/luma-calendars";

describe("lumaCalendars (DB + env merge)", () => {
  afterEach(() => {
    __bustCalendarCache();
    delete process.env.LUMA_API_KEY;
    delete process.env.LUMA_WEBHOOK_SECRET;
    vi.restoreAllMocks();
  });

  it("merges DB rows over env calendars (DB wins on id conflict) and dedupes", async () => {
    process.env.LUMA_API_KEY = "env-default-key";
    process.env.LUMA_WEBHOOK_SECRET = "env-default-secret";
    vi.spyOn(db, "listLumaCalendarRows").mockResolvedValue([
      { id: "default", apiKey: "db-default-key", webhookSecret: "db-default-secret", calendarId: "cal-d", city: "NYC", calendarUrl: null },
      { id: "london", apiKey: "db-london-key", webhookSecret: "db-london-secret", calendarId: "cal-l", city: "London", calendarUrl: null },
    ]);
    __bustCalendarCache();
    const cals = await lumaCalendars();
    const byId = Object.fromEntries(cals.map((c) => [c.id, c.apiKey]));
    expect(byId).toEqual({ default: "db-default-key", london: "db-london-key" }); // DB 'default' wins over env
  });

  it("falls back to env-only when the DB read throws (fail-open for webhook verify)", async () => {
    process.env.LUMA_API_KEY = "env-default-key";
    process.env.LUMA_WEBHOOK_SECRET = "env-default-secret";
    vi.spyOn(db, "listLumaCalendarRows").mockRejectedValue(new Error("db down"));
    __bustCalendarCache();
    expect(await lumaWebhookSecrets()).toEqual(["env-default-secret"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/luma-calendars.test.ts`
Expected: FAIL — `lumaCalendars` is not async / `__bustCalendarCache` not exported.

- [ ] **Step 3: Rewrite `lib/luma/calendars.ts`**

```ts
import { listLumaCalendarRows, type LumaCalendarRow } from "../db/luma-calendars";

export interface LumaCalendar {
  id: string;
  apiKey: string;
  webhookSecret: string | null;
}

/** Env-defined calendars (the original keyring). Retained so unsetting DB rows
 * or the DB being unreachable still leaves existing calendars working. */
function envLumaCalendars(): LumaCalendar[] {
  const cals: LumaCalendar[] = [];
  if (process.env.LUMA_API_KEY) {
    cals.push({ id: "default", apiKey: process.env.LUMA_API_KEY, webhookSecret: process.env.LUMA_WEBHOOK_SECRET || null });
  }
  for (const [name, value] of Object.entries(process.env)) {
    const m = /^LUMA_API_KEY_(.+)$/.exec(name);
    if (!m || !value) continue;
    cals.push({
      id: m[1].toLowerCase(),
      apiKey: value,
      webhookSecret: process.env[`LUMA_WEBHOOK_SECRET_${m[1]}`] || null,
    });
  }
  return cals;
}

let cache: { at: number; cals: LumaCalendar[]; urls: Map<string, string | null> } | null = null;
const TTL_MS = 60_000;

/** Test-only: clear the cache so a re-read reflects new mocks/rows. */
export function __bustCalendarCache(): void {
  cache = null;
}

async function load(): Promise<{ cals: LumaCalendar[]; urls: Map<string, string | null> }> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  let rows: LumaCalendarRow[] = [];
  try {
    rows = await listLumaCalendarRows();
  } catch {
    rows = []; // fail-open to env — a DB blip must not break webhook verification
  }
  const byId = new Map<string, LumaCalendar>();
  const urls = new Map<string, string | null>();
  for (const c of envLumaCalendars()) byId.set(c.id, c);
  for (const r of rows) {
    byId.set(r.id, { id: r.id, apiKey: r.apiKey, webhookSecret: r.webhookSecret }); // DB wins
    urls.set(r.id, r.calendarUrl);
  }
  cache = { at: Date.now(), cals: [...byId.values()], urls };
  return cache;
}

/** Discover the configured Luma calendars (DB rows merged over env; DB wins). */
export async function lumaCalendars(): Promise<LumaCalendar[]> {
  return (await load()).cals;
}

/** The API key for a calendar id; empty/undefined → 'default'. Throws if unknown. */
export async function apiKeyForCalendar(id: string | null | undefined): Promise<string> {
  const cid = id || "default";
  const cal = (await lumaCalendars()).find((c) => c.id === cid);
  if (!cal) {
    const varName = cid === "default" ? "LUMA_API_KEY" : `LUMA_API_KEY_${cid.toUpperCase()}`;
    throw new Error(`Unknown Luma calendar "${cid}" — not in luma_calendars and ${varName} is not set.`);
  }
  return cal.apiKey;
}

/** The public calendar URL for a calendar id (DB row, else env), or null. */
export async function calendarUrlForCalendar(id: string | null | undefined): Promise<string | null> {
  const cid = id || "default";
  const fromDb = (await load()).urls.get(cid);
  if (fromDb) return fromDb;
  const suffix = cid === "default" ? "" : `_${cid.toUpperCase()}`;
  return process.env[`LUMA_CALENDAR_URL${suffix}`] || null;
}

/** Every configured webhook signing secret, for multi-calendar inbound verify. */
export async function lumaWebhookSecrets(): Promise<string[]> {
  return (await lumaCalendars()).map((c) => c.webhookSecret).filter((s): s is string => !!s);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/luma-calendars.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/luma/calendars.ts tests/luma-calendars.test.ts
git commit -m "feat(luma): calendars read from DB (env-merge + 60s cache); functions now async"
```

---

### Task 4: Await the now-async calendar functions at all call sites

**Files (each: add `await`):**
- Modify: `lib/luma/client.ts` — in `resolveEventIdViaCalendars`: `for (const cal of await lumaCalendars())`.
- Modify: `lib/events/register.ts:65` — `for (const cal of await lumaCalendars())`.
- Modify: `lib/events/luma-stats.ts:42` — `apiKey = await apiKeyForCalendar(e.luma_calendar)`.
- Modify: `lib/events/decline-pending.ts:52` — `const apiKey = await apiKeyForCalendar((await getEventById(eventId))?.luma_calendar)`.
- Modify: `lib/email/comms.ts:63` — `calendarUrl: await calendarUrlForCalendar((d.luma_calendar as string) ?? null)` (ensure the enclosing function is `async`; it is — `sendBookingComms`).
- Modify: `app/api/webhooks/luma/route.ts:26` — `const secrets = await lumaWebhookSecrets();`.
- Modify: `app/api/webhooks/notion/[workspace]/route.ts:49` — `apiKey: await apiKeyForCalendar(cal)` (already inside an `async` closure).

- [ ] **Step 1: Apply the `await` edits above.**

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If any call site is in a non-async function, make it async and await its callers — grep `apiKeyForCalendar\|lumaCalendars\|lumaWebhookSecrets\|calendarUrlForCalendar` to confirm all are awaited.)

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: all pass (367+). The vanity-resolution tests still pass because `lumaCalendars()` now resolves via the mocked DB/env.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(luma): await the now-async calendar lookups at all call sites"
```

---

# Phase 2 — Progressive onboarding from the add-event form

### Task 5: `listUpcomingCalendarEvents` + `resolveNewCalendarEvent`

**Files:**
- Modify: `lib/luma/client.ts` — export richer list helper.
- Create: `lib/events/onboard.ts`
- Test: `tests/onboard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/onboard.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveNewCalendarEvent } from "@/lib/events/onboard";

afterEach(() => vi.unstubAllGlobals());

const page = {
  ok: true,
  json: async () => ({
    entries: [
      { id: "evt-SF", url: "https://luma.com/buildbar-sf-oct", calendar_id: "cal-NA",
        geo_address_json: { city: "San Francisco" } },
    ],
    has_more: false,
  }),
};

describe("resolveNewCalendarEvent", () => {
  it("matches a vanity URL with the pasted key and returns evt/cal/city", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page as Response));
    const r = await resolveNewCalendarEvent({ lumaEvent: "https://luma.com/buildbar-sf-oct", apiKey: "secret-x" });
    expect(r).toEqual({ eventId: "evt-SF", calendarId: "cal-NA", city: "San Francisco", apiKey: "secret-x" });
  });

  it("throws a clear error when the key can't see the event", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ entries: [], has_more: false }) } as Response)));
    await expect(
      resolveNewCalendarEvent({ lumaEvent: "https://luma.com/buildbar-sf-oct", apiKey: "wrong" }),
    ).rejects.toThrow(/can't see this event/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/onboard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3a: Export the richer list helper in `lib/luma/client.ts`**

Add (near `findEventIdInCalendar`), and refactor `findEventIdInCalendar` to use it:

```ts
export interface UpcomingCalEvent {
  id: string;        // evt-…
  url: string | null;
  calendarId: string | null;
  city: string | null;
}

/** All upcoming events for a calendar key (2-day back-buffer), paginated. */
export async function listUpcomingCalendarEvents(apiKey: string): Promise<UpcomingCalEvent[]> {
  const after = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const out: UpcomingCalEvent[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL(`${BASE}/v1/calendars/events/list`);
    url.searchParams.set("after", after);
    url.searchParams.set("pagination_limit", "50");
    if (cursor) url.searchParams.set("pagination_cursor", cursor);
    const res = await fetch(url, { headers: { "x-luma-api-key": apiKey } });
    if (!res.ok) throw new Error(`Luma calendars/events/list failed: HTTP ${res.status}`);
    const body = (await res.json()) as {
      entries?: Array<{ id: string; url?: string; calendar_id?: string; geo_address_json?: { city?: string } }>;
      has_more?: boolean; next_cursor?: string;
    };
    for (const e of body.entries ?? []) {
      out.push({ id: e.id, url: e.url ?? null, calendarId: e.calendar_id ?? null, city: e.geo_address_json?.city ?? null });
    }
    cursor = body.has_more && body.next_cursor ? body.next_cursor : undefined;
  } while (cursor);
  return out;
}
```

Then simplify `findEventIdInCalendar` to reuse it:

```ts
async function findEventIdInCalendar(apiKey: string, slug: string): Promise<string | null> {
  for (const e of await listUpcomingCalendarEvents(apiKey)) {
    if (e.url && slugFromUrl(e.url) === slug) return e.id;
  }
  return null;
}
```

- [ ] **Step 3b: Write `lib/events/onboard.ts`**

```ts
import { listUpcomingCalendarEvents } from "../luma/client";

/** The slug of a Luma URL = its last path segment, lowercased. */
function slug(u: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    const seg = url.pathname.split("/").filter(Boolean).pop();
    return seg ? seg.toLowerCase() : null;
  } catch {
    return null;
  }
}

export interface OnboardResolution {
  eventId: string;
  calendarId: string | null;
  city: string | null;
  apiKey: string;
}

/**
 * Validate a pasted Luma API key against the event being added: list the key's
 * upcoming events and match by evt- id (if the input contains one) or vanity slug.
 * Returns the evt- id, the owning cal- id, and the event's city — all from the
 * authenticated API, so it doubles as proof the key is correct.
 */
export async function resolveNewCalendarEvent(input: { lumaEvent: string; apiKey: string }): Promise<OnboardResolution> {
  const wantedId = input.lumaEvent.match(/evt-[A-Za-z0-9]+/)?.[0] ?? null;
  const wantedSlug = slug(input.lumaEvent);
  const events = await listUpcomingCalendarEvents(input.apiKey);
  const match = events.find(
    (e) => (wantedId && e.id === wantedId) || (wantedSlug && e.url && slug(e.url) === wantedSlug),
  );
  if (!match) {
    throw new Error(
      "That API key can't see this event — check you copied the right calendar's key and that the event is upcoming.",
    );
  }
  return { eventId: match.id, calendarId: match.calendarId, city: match.city, apiKey: input.apiKey };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/onboard.test.ts tests/luma-client.test.ts`
Expected: PASS (onboard tests green; existing client tests still green after the `findEventIdInCalendar` refactor).

- [ ] **Step 5: Commit**

```bash
git add lib/luma/client.ts lib/events/onboard.ts tests/onboard.test.ts
git commit -m "feat(luma): onboarding resolver — validate a pasted key against the event"
```

---

### Task 6: Progressive `needsCalendar` branch in the add-event route

**Files:**
- Modify: `app/api/hub/add-event/route.ts`

Behavior:
1. Parse existing fields + new optional ones: `calendarUrl`, `calendarApiKey`, `calendarWebhookSecret`, `calendarSlug`.
2. Try the normal register. If it throws because no connected calendar owns the event AND no `calendarApiKey` was supplied → return `{ ok:false, needsCalendar:true, ... }` (200) instead of the generic error.
3. If `calendarApiKey` supplied → `resolveNewCalendarEvent`, `upsertLumaCalendar`, `__bustCalendarCache`, then register by the resolved evt- id.

- [ ] **Step 1: Make `register` distinguish the unconnected-calendar case**

In `lib/events/register.ts`, replace the throw at the "not found in any configured calendar" branch with a typed error:

```ts
// near the top of register.ts
export class CalendarNotConnectedError extends Error {
  constructor(public eventId: string) {
    super(`Luma event ${eventId} is not on any connected calendar.`);
    this.name = "CalendarNotConnectedError";
  }
}
```

and:

```ts
  if (!detail) {
    throw new CalendarNotConnectedError(eventId);
  }
```

- [ ] **Step 2: Rewrite the route body** (`app/api/hub/add-event/route.ts`)

Keep the token check and required-field checks. Replace the `try { registerEventFromLuma… }` block with:

```ts
  const calendarUrl = String(form.get("calendarUrl") ?? "").trim() || undefined;
  const calendarApiKey = String(form.get("calendarApiKey") ?? "").trim() || undefined;
  const calendarWebhookSecret = String(form.get("calendarWebhookSecret") ?? "").trim() || undefined;
  const calendarSlug = String(form.get("calendarSlug") ?? "").trim() || undefined;

  try {
    let registerInput = { lumaEvent, city, slotStart, slotLengthMinutes };

    // New calendar path: user supplied a key for an unconnected calendar.
    if (calendarApiKey) {
      const resolved = await resolveNewCalendarEvent({ lumaEvent, apiKey: calendarApiKey });
      const id = (calendarSlug || resolved.city || resolved.calendarId || "calendar")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      await upsertLumaCalendar({
        id,
        apiKey: calendarApiKey,
        webhookSecret: calendarWebhookSecret ?? null,
        calendarId: resolved.calendarId,
        city: resolved.city,
        calendarUrl: calendarUrl ?? null,
      });
      __bustCalendarCache();
      registerInput = { ...registerInput, lumaEvent: resolved.eventId, publicUrl: calendarUrl ?? undefined } as typeof registerInput;
    }

    const result = await registerEventFromLuma(registerInput);

    let warning: string | undefined;
    if (result.city) {
      try {
        const channelId = await lookupChannelIdByName(slackChannel);
        await setCityChannelName({ city: result.city, channelName: slackChannel, channelId });
        if (!channelId) {
          warning = `Event added, but the Slack channel "${slackChannel}" couldn't be resolved — invite @build_bar_bot to it, then run the channel-id backfill (or set a webhook_url). Until then, recruit posts for ${result.city} won't send.`;
        }
      } catch (chErr) {
        console.error("[add-event] channel save failed", chErr);
        warning = `Event added, but attaching the Slack channel failed — configure the channel for ${result.city} manually so recruit posts can send.`;
      }
    }

    return NextResponse.json({
      ok: true,
      ...(warning ? { warning } : {}),
      event: { name: result.eventName, slots: result.inserted + result.updated, importedGuests: result.importedGuests },
    });
  } catch (err) {
    if (err instanceof CalendarNotConnectedError && !calendarApiKey) {
      // Not an error — prompt the operator to connect this calendar.
      return NextResponse.json({
        ok: false,
        needsCalendar: true,
        error:
          "This event's Luma calendar isn't connected yet. Paste its Luma API key below to connect it (one-time), then add the event.",
      });
    }
    console.error("[add-event] register failed", err);
    const msg =
      err instanceof Error && /can't see this event/i.test(err.message)
        ? err.message // surface the actionable key-validation message verbatim
        : "Couldn't add that event. Check the Luma URL and try again.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
```

Add imports at the top:

```ts
import { registerEventFromLuma, CalendarNotConnectedError } from "@/lib/events/register";
import { resolveNewCalendarEvent } from "@/lib/events/onboard";
import { upsertLumaCalendar } from "@/lib/db/luma-calendars";
import { __bustCalendarCache } from "@/lib/luma/calendars";
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`RegisterInput` already has optional `publicUrl`.)

- [ ] **Step 4: Run the suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/events/register.ts app/api/hub/add-event/route.ts
git commit -m "feat(add-event): progressive needsCalendar branch + connect-calendar-then-register"
```

---

### Task 7: Form — calendar URL field + progressive reveal + grab-key instructions

**Files:**
- Modify: `components/hub/AddEventForm.tsx`

- [ ] **Step 1: Extend the `Result` type and add state**

```ts
type Result =
  | { ok: true; warning?: string; event: { name: string; slots: number; importedGuests: number } }
  | { ok: false; needsCalendar?: boolean; error: string };
```

Add near the other state:

```ts
  const [needsCalendar, setNeedsCalendar] = useState(false);
```

In `onSubmit`, after parsing the response:

```ts
    const data = (await res.json()) as Result;
    setResult(data);
    if (!data.ok && data.needsCalendar) setNeedsCalendar(true);
    setBusy(false);
```

- [ ] **Step 2: Add the calendar-URL field** (after the Slack channel field)

```tsx
      <label className="block text-sm">
        <span className="text-neutral-600">Luma calendar URL</span>
        <input name="calendarUrl" placeholder="https://luma.com/notion-london" className={`mt-1 ${field}`} />
      </label>
```

- [ ] **Step 3: Add the progressive connect-calendar block** (render only when `needsCalendar`)

```tsx
      {needsCalendar ? (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-900">Connect this Luma calendar (one-time)</p>
          <p className="text-amber-800">
            We don&apos;t have an API key for this event&apos;s calendar yet. In Luma, open the calendar →{" "}
            <strong>Settings → Options → Luma API</strong>, copy the <code>secret-…</code> key, and paste it here.
            (Optional: a Webhook secret from the same page enables live guest sync.)
          </p>
          <input name="calendarApiKey" placeholder="secret-… (Luma API key)" className={field} />
          <input name="calendarWebhookSecret" placeholder="Webhook secret (optional)" className={field} />
          <input name="calendarSlug" placeholder="Short id for this calendar (e.g. london)" className={field} />
        </div>
      ) : null}
```

- [ ] **Step 4: Manual verification**

Run the app locally (`npm run dev`), open `/add-event`.
- Paste a connected-calendar vanity URL (e.g. `https://luma.com/buildbar-sf-oct` once SF is connected via `default`) → adds without the amber block.
- Paste an unconnected-calendar URL → amber block appears with the grab-key instructions; pasting a valid key + slug connects it and adds the event.

- [ ] **Step 5: Commit**

```bash
git add components/hub/AddEventForm.tsx
git commit -m "feat(add-event): calendar URL field + progressive connect-calendar UI with instructions"
```

---

### Task 8 (optional cleanup, later): seed + retire env vars

Once DB rows exist for every calendar and are verified in prod:
- [ ] Insert `default` and `sydney` rows into `luma_calendars` (via SQL, using the current env key values).
- [ ] Remove `LUMA_API_KEY(_SYDNEY)` / `LUMA_WEBHOOK_SECRET(_SYDNEY)` / `LUMA_CALENDAR_URL*` from Vercel.
- [ ] Remove the `envLumaCalendars()` merge from `lib/luma/calendars.ts` and its tests.
- [ ] Commit: `chore(luma): retire env keyring now that calendars live in the DB`.

Keep this LAST and separate — the env-merge means the system is fully correct without it.

---

## Self-review notes

- **Spec coverage:** table + RLS (Task 1) ✓; DB-backed async calendars w/ env-merge + cache (Tasks 3–4) ✓; progressive onboarding w/ key-validation + instructions (Tasks 5–7) ✓; calendar URL captured + stored (Tasks 6–7) ✓; Slack routing still via `slack_channels` (Task 6 keeps `setCityChannelName`) ✓; error-message fix (Task 6) ✓; Notion booking mirror unchanged (events flow into existing ingest/push — no task needed) ✓.
- **Not scraping for onboarding:** a brand-new calendar is resolved with the *pasted key* via `calendars/events/list` (returns `calendar_id` + city), so no Cloudflare-exposed scrape is on the onboarding path.
- **Cache correctness:** `__bustCalendarCache()` is called right after `upsertLumaCalendar` so the immediately-following `registerEventFromLuma` sees the new calendar.
- **Type consistency:** `LumaCalendarRow` (Task 2) is the single row shape used in Tasks 3 & 6; `resolveNewCalendarEvent` returns `{eventId, calendarId, city, apiKey}` used verbatim in Task 6.
