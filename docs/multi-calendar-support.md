# Multi-Calendar Support — Design & Porting Guide

How this project went from **one Luma calendar** to **N calendars** (one per
region/city), with self-service onboarding. Written so the pattern can be ported
to another project. File paths below are this repo's; the pattern is general.

---

## 1. The core problem

A single Luma calendar was hard-wired via env vars (`LUMA_API_KEY`,
`LUMA_WEBHOOK_SECRET`). Luma issues **API keys per calendar** — there is no
org-wide key — so supporting N calendars means storing N `(api_key,
webhook_secret)` pairs and routing every inbound/outbound call to the right one.

**Key mental model:** every event is *owned by exactly one calendar*. Resolve the
owner **once**, tag the event with a calendar id, and all later calls look up
credentials by that tag. Ownership is decided by the provider (a Luma key can
only read its own calendar's events), never by string-matching names.

---

## 2. Database: the calendar registry

A single table is the source of truth for calendar credentials + metadata.
(Previously env vars; moving to the DB enables no-redeploy, self-service adds.)

```sql
-- migrations/0050_luma_calendars.sql
create table if not exists public.luma_calendars (
  id             text primary key,   -- slug; ALSO the value stored on each event (events.luma_calendar)
  api_key        text not null,      -- secret; server-only
  webhook_secret text,               -- secret; nullable (inbound sync)
  calendar_id    text,               -- provider's calendar id (e.g. Luma 'cal-…'), for dedupe
  city           text,               -- optional default; per-event city is derived separately
  calendar_url   text,               -- public "follow" link, for emails
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.luma_calendars enable row level security;
-- NO policies on purpose: anon/authenticated are fully blocked; only the
-- service-role client (which bypasses RLS) ever reads/writes. Same posture as
-- any other secret-bearing table in the app.

-- updated_at trigger (standard)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger trg_luma_calendars_updated_at
  before update on public.luma_calendars
  for each row execute function public.set_updated_at();
```

**Porting notes**
- `id` is a human slug (`nyc`, `sydney`, `korea`) and doubles as the per-record
  foreign tag on your events table (`events.luma_calendar`). Keep them the same so
  routing is a plain lookup.
- RLS **deny-all + service-role-only** is the whole security model for the keys.
  No app-level encryption — the table is only reachable with the service-role key.
  Add envelope encryption only if a DB dump leaking ciphertext-only is a real
  requirement.
- `calendar_id` (the provider's own id) exists to **dedupe**: re-adding the same
  calendar under a different slug should update, not duplicate.

Your events table needs a nullable tag column:

```sql
alter table events add column luma_calendar text;  -- null/'default' = the original calendar
```

---

## 3. Data-access layer (thin, typed, service-role only)

`lib/db/luma-calendars.ts` — the only place that touches the table.

```ts
export interface LumaCalendarRow {
  id: string; apiKey: string; webhookSecret: string | null;
  calendarId: string | null; city: string | null; calendarUrl: string | null;
}
export function mapCalendarRow(r): LumaCalendarRow { /* snake_case → camelCase (pure, unit-tested) */ }
export async function listLumaCalendarRows(): Promise<LumaCalendarRow[]>          // select all
export async function upsertLumaCalendar(input: LumaCalendarRow): Promise<void>   // onConflict: "id"
export async function getLumaCalendarByCalendarId(calendarId): Promise<LumaCalendarRow | null> // dedupe lookup
```

All go through the service-role Supabase client. `listLumaCalendarRows` throws on
DB error so callers can decide fail-open vs fail-loud.

---

## 4. The credential/routing module (the heart)

`lib/luma/calendars.ts` exposes four functions that the rest of the app uses.
Everything that needs a calendar's key/secret/url goes through here, so swapping
the *source* (env → DB) touched only this file + adding `await` at call sites.

```ts
interface LumaCalendar { id: string; apiKey: string; webhookSecret: string | null }

async function lumaCalendars(): Promise<LumaCalendar[]>            // all calendars (DB ∪ env; DB wins)
async function apiKeyForCalendar(id): Promise<string>             // outbound calls; throws if unknown
async function calendarUrlForCalendar(id): Promise<string | null> // email link
async function lumaWebhookSecrets(): Promise<string[]>           // inbound verify (see §6)
```

Three design decisions worth copying:

**(a) DB merged over env, DB wins.** During migration, read both: env-defined
calendars stay working, DB rows override on id conflict. This lets you ship the
table, seed rows, verify, then delete env vars with **no flag day**. Drop the env
branch later.

```ts
const byId = new Map<string, LumaCalendar>();
for (const c of envLumaCalendars()) byId.set(c.id, c);      // legacy env keyring
for (const r of await listLumaCalendarRows()) byId.set(r.id, toCal(r)); // DB wins
```

**(b) ~60s in-memory cache.** `lumaWebhookSecrets()` runs on *every* inbound
webhook and `lumaCalendars()` on every resolve — don't hit the DB each time. Cache
the loaded set for 60s. Expose a `__bustCalendarCache()` and call it right after
any write, so the writing request sees its own change immediately. Accept a ≤60s
staleness window on *other* serverless instances (a new calendar's webhook could
briefly 401 elsewhere; self-heals on retry + TTL).

**(c) Fail-open on DB error.** If the DB read throws, fall back to env-only rather
than returning an empty set — an empty set would make every event look
"unconnected" and reject every inbound webhook. A transient DB blip must not break
verification.

**Async ripple:** these were sync (env reads) and became async (DB). That's the
only invasive part — every call site adds `await`. Grep for all four names and fix
them; the type system catches the rest.

---

## 5. Event → calendar resolution (decide the owner once)

When registering an event you only have a URL or id, not the calendar. Resolve the
owner via the provider's **authenticated** API, not by scraping or guessing:

- **From a vanity URL:** for each configured calendar, call the provider's
  "list this calendar's events" endpoint with that calendar's key and match the
  event by its public slug. The calendar whose key returns the event **is** the
  owner. (Luma: `GET /v1/calendars/events/list?after=<now>`; match `entry.url`
  slug; `entry.id` is the event id, `entry.calendar_id` the owner.)
- **From an event id of an unknown calendar:** you can't identify the owner without
  a key — prompt for it, then validate the key by listing its events and matching
  the id (see §7).

Write the resolved calendar's `id` onto the event (`events.luma_calendar`). After
that, **never re-resolve** — outbound calls do `apiKeyForCalendar(event.luma_calendar)`.

> **Avoid provider "public page" scraping for resolution.** Luma's public event
> page is Cloudflare-fronted; a server-side `fetch` from a datacenter IP gets
> challenged and fails, while it works from your laptop. Use the authenticated API.
> We keep an HTML scrape only as a last-resort fallback for the no-calendars case.

---

## 6. Inbound webhooks: one endpoint, fan-in by secret

All calendars POST to **one** shared webhook endpoint. Verify the signature
against the **pool of all** configured secrets; the one that verifies identifies
the sender. Route the payload by the globally-unique event id, not by which secret
matched.

```ts
const secrets = await lumaWebhookSecrets();
if (secrets.length && !verifyAnySignature(rawBody, header, secrets)) return 401;
// …then route by the event id in the body.
```

**Gotcha:** verification is enforced whenever *any* calendar has a secret. So a new
calendar whose webhook you've pointed at the endpoint but whose secret you haven't
stored yet will get 401'd — store the secret first, then enable the webhook in the
provider. (This is why we made the webhook secret required at onboarding.)

Outbound (push a status change back to the provider) uses
`apiKeyForCalendar(event.luma_calendar)`.

---

## 7. Self-service onboarding (two entry points)

**A. Just-in-time, from the add-event flow.** Paste an event URL; if it resolves
to no connected calendar, the API returns `{ needsCalendar: true }` and the form
reveals key/secret/url/slug fields. On resubmit, validate the key **against that
exact event** (list the key's events, match the id/slug → proves the key is correct
*and* yields the `calendar_id` + city), upsert the calendar, bust the cache, then
register.

**B. Standalone, no event** (`/add-calendar`). For bulk pre-registering regions:

```ts
async function connectCalendar({ slug, apiKey, webhookSecret, calendarUrl, city }) {
  let events;
  try { events = await listUpcomingCalendarEvents(apiKey); }  // validates the key…
  catch { throw new Error("That API key isn't valid."); }     // …empty list from a valid key is still OK
  const calendarId = calendarUrl.match(/cal-[A-Za-z0-9]+/)?.[0] ?? events[0]?.calendarId ?? null;
  const resolvedCity = city?.trim() || events[0]?.city || null;
  const existing = calendarId ? await getLumaCalendarByCalendarId(calendarId) : null; // dedupe
  const id = existing?.id ?? deriveCalendarId(slug, resolvedCity, calendarId);
  await upsertLumaCalendar({ id, apiKey, webhookSecret, calendarId, city: resolvedCity, calendarUrl });
  bustCalendarCache();
  return { id, calendarId, city: resolvedCity };
}
```

**Validate-before-store is essential** — never save a key the provider rejects.
The list call doubles as the validation.

`deriveCalendarId` normalizes **before** falling back, so a slug that normalizes to
empty (`"!!!"`, non-ASCII) doesn't win over a usable city and produce an empty,
unlookupable primary key:

```ts
function deriveCalendarId(...parts) {
  const norm = s => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  for (const p of parts) { const n = norm(p); if (n) return n; }
  return "calendar";
}
```

---

## 8. Provider gotchas (Luma-specific, but check your provider)

- **Per-calendar API keys, no org key.** N calendars = N keys. Everything above
  assumes this.
- **International `city` is null.** Luma's structured `geo_address_json.city` is
  null for many non-US addresses (Seoul: `city` null, but `city_state` =
  `"Seoul, South Korea"`). Derive city as `city ?? city_state.split(",")[0]`, or
  events outside the US fail a "no city" guard. Apply this wherever you read the
  address (event registration **and** the onboarding resolver).
- **List endpoint returns a leaner address than the get-event endpoint.** The
  list entry may lack `city_state`, so the calendar row's city can come back null
  even when the event's does not. Cosmetic here (per-event city is authoritative).
- **Filter the list by `after=<now>`.** A busy calendar has hundreds of events;
  events being added are always upcoming, so this keeps resolution to a page or two.
- **Slot/option labels are display-only.** We generate slot *times* from the
  event's start time + fixed length + option order; the label text (`"2PM"` vs
  `"14:00"`) is never parsed. Keep options in chronological order.

---

## 9. Porting checklist

1. `calendars` table + RLS deny-all (+ the tag column on your events table).
2. Data-access module (list / upsert / get-by-provider-id), service-role only.
3. Credential module with the 4 lookups: **DB∪env merge, 60s cache + bust,
   fail-open**. Make them async; add `await` at call sites.
4. Resolve owner via the **authenticated list endpoint** (slug/id match), write the
   tag once, never re-resolve.
5. One shared inbound webhook; verify against the **pool** of secrets; route by
   event id. Outbound by tag.
6. Onboarding: **validate the key before storing**; dedupe by provider calendar id;
   safe slug derivation.
7. Handle the provider gotchas (§8) — especially international city derivation.

---

*Reference implementation (this repo):* `migrations/0050_luma_calendars.sql`,
`lib/db/luma-calendars.ts`, `lib/luma/calendars.ts`, `lib/luma/client.ts`
(`resolveLumaEventId`, `listUpcomingCalendarEvents`, `cityFromGeo`),
`lib/events/onboard.ts` (`resolveNewCalendarEvent`, `connectCalendar`,
`deriveCalendarId`), `app/api/hub/add-event/route.ts`,
`app/api/hub/add-calendar/route.ts`, `app/api/webhooks/luma/route.ts`. Full design
in `docs/superpowers/specs/2026-09-02-luma-calendar-registry-design.md`.
