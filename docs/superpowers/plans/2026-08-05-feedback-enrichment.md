# Feedback Form Event-Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans / subagent-driven-development. Steps use `- [ ]`.

**Goal:** Enrich each Ambassador feedback-form response with the correct Event Date + Location (matched by email), derive a numeric Satisfaction score, and mirror every response into an identical Dev database.

**Architecture:** Notion automation → `/api/webhooks/notion/feedback` → hub reads the row, matches email against `bookings`/`events`, writes enrichment onto the Ambassador row, and upserts a mirror row in Dev. Idempotency via a `feedback_mirror` Supabase table.

**Tech Stack:** Next.js App Router (Node runtime), Supabase (loose table access like `email_log`), Notion API v2025-09-03 (data sources), Vitest.

**Constants (pinned from live schema):**
- Ambassador DB `cf3bd8e9cf0d4594b273835809eef5ad`, data source `9bfd46cd-519f-4c0b-95be-08ac97549b51`
- Dev DB `d9ffd103ba354e35aeaf8e11101c2a42`, data source `3d542dad-4839-4dae-b56f-911c0e60fb11`
- Props: email=`What email do you use for Notion?`, `Event Date`, `Location`, satisfaction select=`How satisfied were you with this event?`, plus new `Needs review` (checkbox) + `Satisfaction score` (number)

---

## Task 1: Migration — feedback_mirror table

**Files:** Create `supabase/migrations/0017_feedback_mirror.sql`

```sql
create table if not exists feedback_mirror (
  ambassador_page_id text primary key,
  dev_page_id text,
  matched_event_id uuid references events(id) on delete set null,
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Apply via Supabase MCP. (No type regen — accessed loosely like `email_log`.)

## Task 2: Pure helpers + tests (`lib/db/feedback.ts`, `lib/notion/feedback.ts`, `tests/feedback.test.ts`)

`parseSatisfactionScore(v)` — leading integer or null:
```ts
export function parseSatisfactionScore(v: string | null | undefined): number | null {
  const m = (v ?? "").match(/^\s*(\d+)/);
  return m ? Number(m[1]) : null;
}
```

`selectEventForFeedback(candidates, submittedAtISO)` — 7-day window + most-recent:
```ts
export function selectEventForFeedback(
  candidates: Array<{ eventId: string; eventDate: string; city: string | null }>,
  submittedAtISO: string,
): { eventId: string; eventDate: string; city: string | null } | null {
  const sub = submittedAtISO.slice(0, 10);
  const since = isoDateMinusDays(sub, 7);
  const inWindow = candidates.filter((c) => c.eventDate >= since && c.eventDate <= sub);
  if (!inWindow.length) return null;
  return inWindow.reduce((a, b) => (b.eventDate > a.eventDate ? b : a));
}
```
with `isoDateMinusDays(d, n)` computing an ISO date string n days before d (UTC, no tz shift).

Tests (`tests/feedback.test.ts`): parseSatisfactionScore ("5 - Amazing"→5, "3"→3, "Amazing"→null, ""→null); selectEventForFeedback (in-window vs just-outside 7d boundary; most-recent tiebreak; empty→null).

## Task 3: DB access (`lib/db/feedback.ts`)

- `findEventForFeedback(email, submittedAtISO)`: query `bookings` inner-joined to `events`, event_date in `[sub-7d, sub]`, select `guest_email, notion_email, events!inner(id, event_date, city)`; filter email (lowercased exact against either column) in JS; pass to `selectEventForFeedback`.
- `getFeedbackMirror(ambassadorPageId)` / `upsertFeedbackMirror({...})` — loose `feedback_mirror` access (helper `table()` like `email-log.ts`).

## Task 4: Notion helpers (`lib/notion/feedback.ts`)

- `FB` name constants + DB/data-source id constants.
- `readFeedbackEmail(props)`, `readSatisfactionSelect(props)`.
- `enrichmentProperties({ eventDate, city, needsReview, satisfactionScore })` → Notion props (Event Date date|null, Location select|null, Needs review checkbox, Satisfaction score number when non-null).
- `copyableProperties(props)` → rebuild write payloads for title, rich_text, email, select, multi_select, number, date, checkbox, url, phone_number; skip created_time/others.
- `upsertMirrorRow(devClient, dataSourceId, properties, existingDevPageId?)` → create (parent data_source_id) or update; return dev page id.

## Task 5: Webhook route (`app/api/webhooks/notion/feedback/route.ts`)

Node runtime. Verify secret (`x-webhook-secret`/`x-office-hours-secret`/body.secret vs `NOTION_AMBASSADOR_WEBHOOK_SECRET`) → 401 on mismatch. Extract `page_id` (`data.id ?? page_id ?? pageId ?? id`). Fetch Ambassador page. Compute email, submittedAt=`created_time`, satisfactionScore. `match = findEventForFeedback(...)`. `needsReview = !match`. Update Ambassador row with `enrichmentProperties`. Mirror: `getFeedbackMirror` → build `{ ...copyableProperties, ...enrichment }` → `upsertMirrorRow` into Dev DS → `upsertFeedbackMirror`. `logSync(notion_amb_in, feedback_enriched|feedback_unmatched)`. Always return 200 (best-effort try/catch).

## Task 6: Reconciliation script (`scripts/sync-feedback-schema.ts`)

Read Ambassador DS properties (canonical). Via `dataSources.update` on the Dev DS: set options for `How satisfied…`, `How confident…`, `Would you be interested…`, `Location` to Ambassador's option name list. Add `Needs review` (checkbox) + `Satisfaction score` (number) to BOTH data sources if missing. Idempotent. Run once with `--env-file=.env.local`.

## Task 7: Verify + deploy

`npm run typecheck && npm test` → branch → commit → merge → push → `vercel deploy --prod` → health. Run reconciliation script. Provide the user the Notion-automation setup step.

---

### Self-review
- **Spec coverage:** trigger (T5), match rules (T2/T3), Location select auto-create (T4 enrichmentProperties), mirror + identical schema (T4/T6), idempotency (T1/T3/T5), satisfaction number (T2/T4), tests (T2). ✓
- **Type consistency:** `selectEventForFeedback`/`findEventForFeedback` both return `{eventId,eventDate,city}`; `FB` names reused across T4/T5. ✓
- **No placeholders:** concrete SQL, code, prop names. ✓
