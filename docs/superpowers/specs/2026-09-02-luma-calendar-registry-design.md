# Luma Calendar Registry — DB-backed, self-service onboarding

**Date:** 2026-09-02
**Status:** Approved (brainstorm), pending implementation plan
**Supersedes:** the env-keyring half of `2026-08-25-multi-luma-calendar-design.md`
(the `LUMA_API_KEY_<SUFFIX>` env vars). The routing/webhook/tagging design from
that doc is unchanged — only the *source* of calendar credentials moves.

## Problem

Onboarding a new Luma calendar today means adding ~3 env vars
(`LUMA_API_KEY_<SUFFIX>`, `LUMA_WEBHOOK_SECRET_<SUFFIX>`,
`LUMA_CALENDAR_URL_<SUFFIX>`) in Vercel **and redeploying**. Scaling to ~10 cities
means ~30 env vars and a deploy per city, and it's engineer-only.

Worse, when a calendar isn't connected, `registerEventFromLuma` throws "not found
in any configured calendar," which `POST /api/hub/add-event` rewrites to the
generic, misleading **"Couldn't add that event. Check the Luma URL and try
again."** — even though the URL is fine. (This is exactly how the SF event
`evt-lv9PkzKdC2cvTms`, on calendar `cal-ZDQrtBgbNzSJZkh` = "Notion Build Bar SF",
failed: only `default` (US/NYC) and `sydney` keys are configured.)

Luma issues API keys **per calendar** — there is no org-wide key — so 10 cities
genuinely means 10 keys + 10 webhook secrets. The system is about how we
**store, route, and onboard** those, not avoiding them.

## Goals

- Add a calendar with **no redeploy**, at the moment it's first needed.
- Turn the "calendar not connected" failure into a **prompt**, not a dead end.
- Keep event↔calendar matching **authoritative** (decided by Luma ownership).
- Reuse existing posture: secrets in Supabase, read via the service-role client
  only, protected by RLS deny-all — same as `slack_channels`.

## Non-goals / out of scope (external, still manual)

- **Luma-side webhook subscription.** Storing `webhook_secret` is our half; Luma
  still needs its calendar's webhook pointed at `/api/webhooks/luma` in the Luma
  dashboard. Not settable via API. So the API key alone enables **add events +
  outbound status pushes**; the webhook secret + that dashboard step are what
  enable **inbound guest auto-sync**.
- **Slack setup.** Channel creation + inviting `@build_bar_bot` stays manual
  (unchanged from today).
- App-level encryption of keys (deliberately not done — matching `slack_channels`
  plaintext + RLS + service-role posture is sufficient; revisit only if a real
  threat appears).

## Architecture

Everything routing to a Luma calendar already funnels through **one module**,
`lib/luma/calendars.ts`, with exactly 5 call sites:

- `lumaCalendars()` — `lib/events/register.ts:65` (owner probe)
- `lumaWebhookSecrets()` — `app/api/webhooks/luma/route.ts:26` (inbound verify)
- `apiKeyForCalendar(id)` — `app/api/webhooks/notion/[workspace]/route.ts:49`,
  `lib/events/luma-stats.ts:42`, `lib/events/decline-pending.ts:52`
- `calendarUrlForCalendar(id)` — `lib/email/comms.ts:63`

So swapping the source (env → DB) is a contained change: reimplement these four
functions to read the table; downstream logic is untouched.

### 1. Table: `luma_calendars` (Supabase / Postgres)

| column           | type        | notes |
|------------------|-------------|-------|
| `id` (PK)        | text        | slug — the value already stored on `events.luma_calendar` (e.g. `default`, `sydney`, `sf`) |
| `api_key`        | text NOT NULL | 🔒 service-role reads only |
| `webhook_secret` | text NULL   | 🔒 optional (city can go live on the key alone) |
| `calendar_id`    | text NULL   | the `cal-…` id — enables deterministic matching + ownership check |
| `city`           | text NULL   | default city; used to seed `slack_channels` |
| `calendar_url`   | text NULL   | "follow our calendar" link for guest emails |
| `created_at`     | timestamptz | default now() |
| `updated_at`     | timestamptz | default now() |

RLS: **enabled, no policies** → anon/browser blocked, service-role bypasses.
Identical to `slack_channels`. Slack routing stays in `slack_channels` (keyed by
city + aliases); `luma_calendars` owns **only** Luma credentials. The onboarding
flow writes both.

### 2. Rewrite `lib/luma/calendars.ts` internals, keep the interface

Same four function names; read from the table instead of `process.env`.

- They become **async** (DB read). The 5 call sites add `await`. `register.ts`'s
  `for (const cal of lumaCalendars())` becomes `for (const cal of await
  lumaCalendars())`; the webhook's `lumaWebhookSecrets()` becomes awaited; etc.
- **~60s in-memory cache** (module scope) so the per-inbound-webhook path and the
  register probe don't hit the DB every call. Each serverless instance caches
  independently; acceptable given a tiny, rarely-changing table.
- **Migration safety net:** during rollout, `lumaCalendars()` merges DB rows over
  any env-defined calendars (DB wins on `id` conflict). Ship the table, seed
  `default`+`sydney`, verify, then delete the env vars — no flag day. Remove the
  env-merge once the vars are gone.

### 3. Unified progressive "Add event" flow

The single form does calendar onboarding just-in-time. No separate "add a city"
form.

1. Paste the Luma URL → server scrapes **both** `evt-…` and `cal-…` from the
   public page HTML (both present without auth; verified on the live SF page).
2. Look up `cal-…` in `luma_calendars`:
   - **Known** → register the event immediately (90% path once cities are set up).
   - **Unknown** → do **not** error. Respond `{ needsCalendar: true, calendarId,
     suggestedCity, suggestedName }` and the form **reveals** fields: API key
     (required), webhook secret (optional), calendar URL, slack channel — city/
     name pre-filled from the page.
3. On resubmit with the key, **validate against *this* event**: call Luma
   `event/get` for this `evt-` with the provided key. A 200 proves the key is
   correct *and* owns the event in one call. On failure, reject with
   *"That key can't access this event — did you copy the {city} calendar's key?"*
   (fail-loud, matching recent commits).
4. Insert the `luma_calendars` row, upsert the `slack_channels` row for the city,
   then register the event — one submit.

Contract change to `POST /api/hub/add-event`: it can return a
`needsCalendar` response (200) that the form reacts to, and accept the extra
credential fields on the follow-up submit. Auth stays `verifyFormToken`.

Deterministic matching replaces the N-key probe loop: match by `cal-` id → one
Luma call with that calendar's key (which also confirms ownership). Probe loop
kept only as a fallback when the page yields no `cal-` id.

### 4. Fix the misleading error (the original bug)

In `add-event`, distinguish "no connected calendar owns this event" from a bad
URL. For a known-but-unconnected calendar, the new path is the `needsCalendar`
prompt. For a genuinely unresolvable URL, keep a URL-specific message. Never again
show "Check the Luma URL" when the URL resolved fine.

### 5. Migration / seed

- SQL migration: create `luma_calendars` + RLS.
- One-time seed of `default` and `sydney` rows from current env values.
- After verifying reads come from the DB, delete the per-calendar `LUMA_*` env
  vars and remove the env-merge fallback.

## Data flow (event↔calendar correctness)

- **Right event:** the `evt-…` id is globally unique, scraped from the URL.
- **Right calendar at add time:** decided by Luma ownership — a key can only fetch
  its own calendar's events, so the `cal-` match + `event/get` 200 is
  authoritative. A wrong key gets 401/403; it cannot mis-route.
- **After add:** `events.luma_calendar` is set once; all downstream calls
  (`apiKeyForCalendar`, `calendarUrlForCalendar`) read that tag. No re-guessing.
- **Inbound webhooks:** the `webhook_secret` that validates the signature
  identifies the sending calendar; then route by `evt-` id. "The secret that
  verifies is the owner."

## Error handling

- Unknown calendar on add → `needsCalendar` prompt (not an error).
- Provided key fails `event/get` for this event → reject, name the calendar.
- URL resolves to no `evt-`/`cal-` → URL-specific error.
- DB read failure in `lib/luma/calendars.ts` → throw (fail loud); do not silently
  fall back to an empty calendar set that would make every event "unconnected."

## Testing

- Unit: `lib/luma/calendars.ts` data layer with a DB mock — cache TTL, env-merge
  precedence (DB wins), lookup by id, `lumaWebhookSecrets` aggregation.
- Unit: add-event `needsCalendar` branch — known vs unknown `cal-`, and the
  key-validation reject path (mock Luma `event/get`).
- Existing register/reconcile tests guard the sync→async refactor of the 5 call
  sites.

## Immediate unblock (independent of this work)

To add SF **today**: insert the SF row directly (`id='sf'`, its `cal-` id, key,
webhook secret, city, calendar URL), or set the env var + redeploy. The system
above is what makes cities 3–10 painless.
