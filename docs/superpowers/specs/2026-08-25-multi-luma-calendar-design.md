# Multi-calendar Luma support (add "Notion Sydney")

## Context

The hub integrates one Luma calendar via a single `LUMA_API_KEY` + `LUMA_WEBHOOK_SECRET`.
`lib/luma/client.ts` reads that key directly for every outbound call; the webhook verifies
against the one secret. Adding a second calendar (Notion Sydney, its own key) requires
selecting the **right key per event** and accepting a **second calendar's webhooks**.

## Goal

Full parity for Sydney events (stats, prep/reminder emails, day-before auto-decline, 1:1s,
Slack, feedback — timezone handling already exists), with every existing event untouched.

## Decisions (from brainstorming)

- **Calendar detection: auto-detect by probing keys** at add-event ingest. No manual picker.
- **Full parity** for Sydney.
- **Webhook: shared URL** (`/api/webhooks/luma`), verify against **all** configured secrets,
  route by the payload's globally-unique `luma_event_id`. Not per-calendar URLs.

## Design

### 1. Keyring — `lib/luma/calendars.ts`
```
interface LumaCalendar { id: string; apiKey: string; webhookSecret: string | null }
lumaCalendars(): LumaCalendar[]        // discovered from env
apiKeyForCalendar(id: string): string  // that calendar's key; unknown id throws a clear
                                       // misconfig error ('default' always exists)
```
- `default` calendar = existing `LUMA_API_KEY` / `LUMA_WEBHOOK_SECRET`.
- Additional calendars discovered by scanning `process.env` for `LUMA_API_KEY_<SUFFIX>` (id =
  lowercased suffix; webhook secret from `LUMA_WEBHOOK_SECRET_<SUFFIX>`). Sydney = env vars
  `LUMA_API_KEY_SYDNEY` (+ `LUMA_WEBHOOK_SECRET_SYDNEY`) → calendar id `sydney`. Adding future
  calendars is env-only, no code change.

### 2. Event tagging — `events.luma_calendar`
- New column `text not null default 'default'` (Supabase migration). Existing rows auto-tag
  `default` — keep working, no backfill. Add to the generated types + `EventRow`.
- At ingest, `registerEventFromLuma` **probes** each calendar: try `getLumaEvent(evtId, apiKey)`
  (host-only endpoint 200s only for the owning calendar); first success sets both the event
  detail and `luma_calendar`. None resolve → clear error ("event not found in any configured
  Luma calendar"). Probing is a rare, manual action, so N extra calls is fine.

### 3. Per-event key selection — thread `apiKey` through the client
- Client functions take an explicit key: `getLumaEvent(id, apiKey)`,
  `listEventGuests(id, apiKey)`, `fetchEventStats(id, apiKey)`,
  `updateGuestStatus({ …, apiKey })`. (`resolveLumaEventId` needs no key — public page.)
- Call sites resolve `apiKeyForCalendar(event.luma_calendar)`:
  - `lib/events/luma-stats.ts` (cron, per event)
  - `lib/events/decline-pending.ts` (`declineDeps` — status write-back)
  - `lib/events/backfill.ts`
  - `app/api/webhooks/notion/[workspace]/route.ts` (Notion→Luma status write-back)
  - `lib/events/register.ts` (the probe above)

### 4. Inbound webhook — `/api/webhooks/luma`
- Verify the signature against **every** configured calendar's secret; pass if any matches,
  else 401. (Inbound never calls the Luma API, so no key needed here.)
- Routing is unchanged: ingest looks up the event by `luma_event_id` (already calendar-tagged),
  so a Sydney registration updates the Sydney event deterministically. Unregistered events are
  ignored (existing behavior).

### 5. Migration + types + env
- Migration for `luma_calendar`; regenerate `lib/supabase/types.ts`.
- Add `LUMA_API_KEY_SYDNEY` + `LUMA_WEBHOOK_SECRET_SYDNEY` to Vercel + `.env.local` (never
  committed). Secret provided by the user.

## Non-goals
- Per-calendar webhook URLs. Backfilling existing events (they're all `default`). A calendar
  management UI (env-driven is enough for now).

## Error handling
- Probe finds no owning calendar → registration fails with an actionable message.
- Client calls surface the calendar id in errors for debuggability.
- Multi-secret verify: a payload matching no secret → 401 (unchanged security posture).

## Tests
- Keyring: discovers `default` + `sydney` from env; `apiKeyForCalendar` fallback to default.
- Probe/detect (mock `getLumaEvent`): returns the calendar whose key resolves; throws when none.
- Multi-secret verify: accepts a payload signed by either secret; rejects one signed by neither.
