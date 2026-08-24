# Email Correspondence Log (Hub Page) — Design

**Date:** 2026-08-24
**Status:** Draft (awaiting user review)

## Goal

A Hub page that lists every email the system has sent, so the operator can see
what's gone out and read any individual message. Bulk sends (prep, declines, etc.)
collapse into a single "mass" entry that expands to show each recipient. Paginated
and filterable so it stays manageable as the log grows.

## Data reality

`email_log` stores only **metadata** per send — `booking_id`, `event_kind`,
`recipient_role`, `recipient_email`, `status`, `resend_id`, `created_at` — **not the
email body**. So:
- The **list** is built entirely from `email_log` (full history is already there —
  no data backfill needed).
- **Reading an email's content** fetches the exact sent message from **Resend** by
  `resend_id` (per the user's "exact as-sent" choice). Rows without a `resend_id`
  (skipped/failed) show status only; Resend messages that have aged out show a
  "content no longer available" note.

## Grouping: one entry per (kind, event, day)

Rows collapse by **`event_kind` + `event_id` + UTC calendar day**. A group with
**one** recipient renders as a normal single row; a group with **more than one**
renders as a **"mass (N)"** entry that expands to the recipient list. "Mass" is
emergent from the count — no hardcoded list of which kinds are bulk.

## Components

### 1. DB view — `supabase/migrations/0046_email_correspondence_view.sql`
Create a view `email_correspondence` that aggregates the log (so grouping +
pagination happen in SQL, never loading the whole table):

```sql
create view email_correspondence as
select
  el.event_kind,
  b.event_id,
  e.name  as event_name,
  e.event_date,
  (el.created_at at time zone 'UTC')::date as day,
  count(*)                                   as recipient_count,
  count(*) filter (where el.status = 'sent') as sent_count,
  count(*) filter (where el.status <> 'sent') as unsent_count,
  min(el.created_at) as first_at,
  max(el.created_at) as last_at
from email_log el
join bookings b on b.id = el.booking_id
left join events e on e.id = b.event_id
group by el.event_kind, b.event_id, e.name, e.event_date, day;
```

### 2. Queries — `lib/db/email-correspondence.ts`
- `listEmailGroups({ kind?, eventId?, page, pageSize })` — select from
  `email_correspondence`, apply optional `event_kind` / `event_id` filters, order by
  `last_at desc`, `.range()` for pagination. Returns rows + a `hasMore` flag.
- `listGroupRecipients({ kind, eventId, day })` — the underlying `email_log` rows for
  one group (join `bookings` for `guest_name`), each with `recipient_email`, `status`,
  `resend_id`, `created_at`. Used on expand.
- `listEmailFilterOptions()` — distinct `event_kind`s present + the events present in
  the log (for the two filter dropdowns).

### 3. Resend fetch — `lib/email/resend.ts`
`getSentEmail(resendId)` → `GET https://api.resend.com/emails/{id}` with the API key;
returns `{ subject, html, text, to } | null` (null on 404/aged-out/error). Best-effort.

### 4. Page — `app/settings/emails/log/page.tsx` (server component)
- `export const dynamic = "force-dynamic"`. Renders `<HubNav/>`, `<SettingsNav/>`.
- Reads `searchParams`: `page`, `kind`, `event`.
- Calls `listEmailGroups` + `listEmailFilterOptions`; renders the filter bar,
  the grouped list, and pagination (prev/next preserving filters).
- Auth: covered by `middleware.ts` (all `/settings/*` require a valid hub session).

### 5. Client interactivity — `components/hub/EmailLog.tsx` (client component)
- Renders each group row: date, friendly kind label, event, recipient (single) or
  "mass (N)", and a sent/unsent status summary.
- **Single** row → click fetches content via `/api/hub/emails/content?resendId=…`
  and shows it in a modal (subject + rendered body).
- **Mass** row → expand (fetch `/api/hub/emails/recipients?kind=…&event=…&day=…`) to
  the recipient list; clicking a recipient opens *their* content modal.
- Loading / "no content available" / "nothing sent (status: skipped)" states.

### 6. API routes (each does its own `authed()` check — `/api/*` bypasses middleware)
- `app/api/hub/emails/recipients/route.ts` → `listGroupRecipients(...)`.
- `app/api/hub/emails/content/route.ts` → `getSentEmail(resendId)`.

### 7. Nav — `components/hub/SettingsNav.tsx`
Add `{ href: "/settings/emails/log", label: "Sent log" }`. Fix the active-tab check
so "Emails" isn't highlighted on `/settings/emails/log` (match `/settings/emails`
exactly, or evaluate the log entry first).

## Filters
- **Kind** — dropdown of friendly labels for the `event_kind`s present.
- **Event** — dropdown of events present in the log.
- Both are `searchParams` that constrain `listEmailGroups`; changing a filter resets
  to page 1. Pagination links carry the active filters.

## Pagination
Server-side via `?page=N` (+ filters), page size 50 groups, newest first, using the
view + `.range()`. Prev/Next only (no total count needed).

## Testing
- `emailKindLabel(kind)` (friendly-name mapping) — pure, unit-tested for the known
  kinds + an unknown-kind fallback.
- `getSentEmail` — parses a Resend response; returns null on non-200 / missing id
  (mocked fetch, like the Slack API tests).
- The grouping itself is SQL (the view) — verified by the rollout query, not a unit
  test, matching the codebase's approach to `booking_details`.

## Rollout
1. Apply migration `0046` (create the view).
2. Deploy code.
3. Visit `/settings/emails/log` — confirm the list, a single-email content view, a
   mass entry expanding to recipients, filters, and pagination.

## Open risks / notes
- **Resend retention:** older emails may 404 from Resend → "content no longer
  available." Acceptable (metadata still shown). If exact-history matters long-term,
  a follow-up could persist rendered bodies at send time.
- **UTC-day grouping:** a late-evening US send near midnight UTC could land on the
  next day's group. Acceptable for an internal log; revisit if confusing.
- **Read-only page:** no resend/delete actions in v1 (YAGNI).
