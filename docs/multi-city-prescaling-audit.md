# Office-Hours Multi-City Routing: Pre-Scaling Remediation Plan (2 → 5 cities)

_Generated 2026-08-28 by a multi-agent audit (adversarially verified against the code)._

## 1. Verdict

The routing spine is **fundamentally sound** for 5 cities: events are keyed by globally-unique `luma_event_id` (not city), every cron dispatcher selects a *set* of events and loops with `event_id`-scoped queries and per-event/per-booking dedup guards, and the multi-Luma-calendar keyring already generalizes to N cities env-only. Concurrent cities in the same window cannot cross-contaminate at the core booking/comms layer.

**However, the peripheral attribution and observability layers are not ready.** Two locale-blind address parsers actively misroute non-US cities (Sydney is already live), and a family of "silent skip" gaps (unknown-event webhook drop, unmatched Slack city, un-invited bot, sweep-aborting cron) that are tolerable at 2 hand-tuned cities become invisible data loss at 5.

---

## 2. MUST fix before adding 3 cities (silent data loss or misrouting)

| # | What breaks | Fix | Effort | Location |
|---|---|---|---|---|
| **G-city** | `cityFromAddress` hard-requires a US `ST ZIP5` segment. Sydney (LIVE) parses `"Pyrmont NSW 2009"` or a street name as the city; CA/UK also break. Flows into feedback **Location** for every non-US city. | Stop parsing raw addresses. Use the clean `events.city` (already stored from Luma `geo_address_json.city`, `register.ts:86`) for Build Bar; ingest a clean city field for the Notion 101 DB. | small–med | `lib/notion/notion101.ts:37-46` |
| **G-clobber** | The "enrichment never clobbers the agent" invariant only guards **null**, not wrong values. A truthy garbage city (from G-city) passes `if (input.city)` and `ambassador.pages.update` **overwrites the agent's correct Location**. | Only write Location for a Build Bar booking with a known-good `events.city`; let the agent own Location for Notion 101 events. | small | `lib/db/feedback.ts:125`, `route.ts:106` |
| **F2** | Helper attribution is a separate, unbounded query (no lower date bound, no city/event correlation). A this-week SF feedback row can be stamped with a **Helper from an old NYC 1:1**. | Take the helper from the same chosen event: reuse `EventCandidate.helperName` (already computed, `feedback.ts:75`); drop the decoupled `findHelperForGuest`. | small | `lib/db/feedback.ts:96-128`, `route.ts:86,100,133` |
| **I1** | A webhook for an event id absent from `events` is silently dropped and logged as `result:"applied"` — indistinguishable from success. Guest data lost. Common during staged rollout before a new city's events are synced. | Log with `result:"error"`/action `"unknown_event"` + fire a Slack/ops alert when `getEventByLumaId` returns null. Optionally lazy-backfill. Keep HTTP 200. | small | `lib/events/ingest.ts:29-32`, `app/api/webhooks/luma/route.ts:76-79` |
| **G-luma-stats** | `apiKeyForCalendar(e.luma_calendar)` is called **outside** try/catch in `syncAllLumaStats`. One event tagged with an unset `LUMA_API_KEY_<SUFFIX>` throws → **aborts the whole sweep, 500s the cron** → no stats for any city that tick. | Wrap key resolution in try/catch: `logSync` + `failed++; continue`. | trivial | `lib/events/luma-stats.ts:36` |
| **F5** | Supabase mirror and Notion Dev page permanently disagree when the agent attributes a guest to a different event/city or a Notion-101-only event (`matched_event_id=null` → excluded from rollups). No reconciliation. | After enrichment, re-read agent-set Event Date + Location, resolve to `events.id`, update `feedback_mirror.matched_event_id` on mismatch; persist agent city/date. | medium | `app/api/webhooks/notion/feedback/route.ts:85,106,118,123` |

---

## 3. Should fix soon (quality degradation, not data loss)

- **S1 — Unmatched Slack city silently skips recruit.** Geocoded `events.city` must exactly equal a city/alias. **Fix:** normalized/contains fallback (strip `, NY`/`, USA`) + route near-misses to a fallback `#ops` channel; CI assertion that every booking city maps to a channel. `lib/db/slack.ts:22-26`.
- **S2 — `add-event` returns `ok:true` even when channel-id resolution fails** → unpostable city, green success, no warning. **Fix:** return `channelResolved` + warning; flag pending manual `webhook_url`. `app/api/hub/add-event/route.ts:36-40`.
- **S4 — Un-invited bot silently drops posts.** **Fix:** on `not_in_channel`, attempt one `conversations.join` + retry; distinct `slack_bot_not_in_channel` log; self-join at setup. `lib/slack/client.ts:112-121`.
- **I2 — Ingest calendar-tagging is "first key that resolves" and mis-tags on transient errors** (429/timeout from true owner → later key → wrong-key 4xx). **Fix:** probe all calendars (throw on ambiguity), distinguish 404 from transient, prefer explicit calendar id. `lib/events/register.ts:65-74`.
- **I3 — Retiring the default calendar breaks the shared webhook.** `lumaCalendars()` eagerly calls `required("LUMA_API_KEY")`. **Fix:** push `default` only when the env var is truthy. `lib/luma/calendars.ts:22-24`. *(trivial)*
- **E1 — Single hardcoded calendar link for all cities** (`CALENDAR_URL` in 6 guest templates). **Fix:** per-city `calendarUrl` from `luma_calendar`, fall back to `CALENDAR_URL`. `lib/email/templates.ts:8,620`.
- **F4 — Unattributed feedback is invisible** (email-mismatch → `matched_event_id=null`, excluded from per-event buckets but silently folded into the overall rollup). **Fix:** split attributed/unattributed in `computeResults`, surface an "N unattributed" count. `lib/hub/results.ts:135,150`.
- **G-101-routing — Notion 101 match has no date window + email-only** → repeat cross-city guest misattributed. **Fix:** bounded lookback + city tag; flag multi-candidate matches. `lib/notion/notion101.ts:14,63-65`.

---

## 4. Safe to defer (minor)

- **F1** — Same-week two-city feedback picks most-recent-by-date (rare). Flag `ambiguous` when >1 distinct-city candidate in-window. `lib/db/feedback.ts:36-38`.
- **S3** — Slack channel lookup aborts at 2.5s / no retry on large workspaces. Backfill script re-resolves. Raise timeout to 8–10s + retry. `lib/slack/api.ts:36,90`.
- **E2** — Null `public_url` falls back to the generic (city-agnostic) calendar in "cancel your registration" links (degraded UX, not misroute). Omit the sentence when no real URL. `lib/email/templates.ts:622`.
- **G-ICS-seq** — SEQUENCE from `floor(now/1000)`; same-second CANCEL+PUBLISH can be dropped by clients. Not city-related. Persist `bookings.ics_sequence`. `lib/email/ics.ts:56`.
- **G-reconcile-batching** — reconcile cron is unbounded serial work vs `maxDuration=120`; no `ORDER BY` starves the same tail. Self-healing hourly. Add `ORDER BY`, paginate, or parallelize. `lib/events/reconcile-cards.ts:23-40`.
- **G-location-hygiene** — junk Location options fragment rollups (subsumed by G-city).

**Refuted / downgraded (checked, no action):** I4 (UNIQUE+nullable collision unreachable — lookups use `.eq`, inserts always write a non-null id), I5 (`evt-` regex runs on pre-selected `event.id`, not raw payload; wrong id cancels nothing), EP (no single-current-event assumption anywhere — all crons are event-set-scoped with per-event dedup).

---

## 5. Operational checklist per new city (none automated today)

1. **`LUMA_API_KEY_<SUFFIX>`** — a missing/typo'd key now aborts the entire stats sweep; verify before tagging events.
2. **`LUMA_WEBHOOK_SECRET_<SUFFIX>`** — so the shared webhook verifies that calendar's signatures.
3. **Public calendar URL** — add to the per-city map (once E1 lands); until then guests get the NYC calendar link.
4. **`slack_channels` row + all geocoded aliases** (`New York`, `Brooklyn`, `Manhattan`, `New York, NY`…). Exact-match only; unlisted alias silently skips recruit posts.
5. **Resolve + confirm `channel_id`** — run `scripts/backfill-slack-channel-ids.ts`; `ok:true` does not currently mean the id resolved.
6. **Manual `webhook_url`** on the row (defaults to `""` = unpostable).
7. **`/invite @build_bar_bot`** to the channel; else posts fail `not_in_channel` silently.
8. **Timezone / event dates** correct — the feedback windows and day-of blasts key off `event_date`.
9. **Clean city string** — `events.city` and the Notion 101 row must carry a canonical city name, not a raw street address (critical for non-US until G-city/G-clobber land).
10. **Verify end-to-end** — test registration + feedback: no `unknown_event`, stats sweep completes, recruit posts land, feedback attributes to the right city.
