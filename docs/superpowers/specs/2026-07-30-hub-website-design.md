# Office Hours Hub — Web UI Design

**Date:** 2026-07-30
**Status:** Approved

## Goal

An admin console over the Supabase source of truth (events → slots → bookings)
living in the existing `office-hours` Next.js app. A read-only dashboard for
organizers to see all bookings/slots/events across cities, plus a separate,
public, Notion-embeddable form to register a new Luma event for tracking.

## Scope

**In scope (v1):**
- Gated dashboard at `/` with three tabs: Bookings, Slots, Events.
- Public, embeddable Add-Event form at `/add-event`.
- Password gate + signed-cookie session for the dashboard.
- Sync status strip (last sync time + tracked-event count) — no conflict UI.
- Tailwind for a clean Notion-like aesthetic.

**Out of scope (v1):**
- Editing/claiming/cancelling bookings from the hub (stays in Notion).
- Conflict / double-book resolution UI (the mockup's alert) — will not happen.
- Realtime / polling. Server-render on load + manual Refresh.
- Google SSO (recommended future upgrade; password gate for now).

## Architecture

**Approach A — Server Components read Supabase directly.** Dashboard pages are
React Server Components that query via the existing `lib/db` helpers (service
role, server-only). Middleware + a signed HttpOnly cookie guard the dashboard.
`/add-event` is a separate public route posting to a public API route that runs
the existing `registerEventFromLuma`. Light client components handle tab
switching, filter chips, and search. Service-role key never reaches the browser.

## Routes

### `/add-event` (public, embeddable)
- Minimal single-purpose form. Fields:
  - **Luma event URL** (required) — accepts a full `lu.ma/...` URL or a raw
    `evt-...` id.
  - **City override** (optional) — otherwise auto-derived from the Luma address.
  - **Slot start time** (optional ISO) and **Slot length minutes** (optional,
    default 30).
- Submits to `POST /api/hub/add-event`. On success shows a card: event name,
  city, event date, number of slots created/reconciled. On failure shows a clear
  message (bad URL, event not found, Luma auth error).
- Sets `Content-Security-Policy: frame-ancestors https://*.notion.so
  https://notion.so` and does NOT set `X-Frame-Options`, so it embeds in a Notion
  page. Standalone chrome (no dashboard nav).
- Anti-abuse: the form includes a same-origin submission token (issued by the
  page, verified by the API) to stop drive-by/bot posts without requiring login.

### `/login` (public)
- Password field → `POST /api/hub/login`. On correct password, set signed
  HttpOnly cookie `hub_session` and redirect to `/`. On failure, show an error.

### `/` (gated dashboard)
- Redirects to `/login` if no valid session cookie (enforced by middleware).
- Renders the sync strip + tab bar + active tab.

## Dashboard components

**Sync strip (top):** `Hub → Notion Dev → Ambassador · Last sync {relative} · {N}
events tracked`. Last-sync from the most recent successful `hub_to_dev`/`hub_to_amb`
`sync_log` row; count from `events` (non-cancelled). No conflict UI.

**Bookings tab (primary):** Table columns — Guest · Status · Slot · City ·
Booked by · Helper type · Challenge. Source: `booking_details` view (joins event
+ slot). Grouped by city. City+month **filter chips** derived from tracked
events. **Search** box (client-side filter over guest name / company / email).
Status rendered as colored pills: Assigned, Checked In, Unassigned, Cancelled.

**Slots tab:** Event · City · Date · Time label · Booked/Available · Guest (if
booked). Source: `slots` joined to `events` and any booking.

**Events tab:** Name · City · Date · Luma id · #slots · #bookings · Status.
A **New** button links to `/add-event`.

**Refresh:** a button that re-fetches (server revalidation). Server-rendered on
load otherwise.

## Data flow

- Dashboard RSCs call `lib/db` read helpers (add read-only aggregate helpers as
  needed: list bookings via `booking_details`, list slots with event+booking,
  list events with slot/booking counts, sync summary). Service role, server-only.
- `/api/hub/add-event`: validate token → parse URL/id → `registerEventFromLuma`
  → return `{ok, event}` or `{ok:false, error}`.
- `/api/hub/login`: constant-time compare against `HUB_PASSWORD` → set cookie.

## Security

- **Middleware** guards `/` (and `/api/hub/data*` if used); allows `/add-event`,
  `/api/hub/add-event`, `/login`, `/api/hub/login`, and static assets.
- **Session cookie** `hub_session`: HttpOnly, Secure, SameSite=Lax, value is an
  HMAC-SHA256 signature (Web Crypto, edge-compatible) over a fixed payload using
  `HUB_SESSION_SECRET`; middleware verifies the signature.
- **Password**: compared with a constant-time check against `HUB_PASSWORD`.
- New env vars: `HUB_PASSWORD`, `HUB_SESSION_SECRET` (added to `.env.local` +
  Vercel). Service-role key stays server-only (never shipped to client).

## Styling

- Add Tailwind (tailwindcss + postcss + autoprefixer) and configure. Recreate the
  Notion aesthetic: light gray canvas, white table surface, subtle 1px borders,
  rounded cards, colored status pills, system sans font.

## Testing

- Unit: add-event URL/id parsing; add-event API happy-path + error mapping (mock
  `registerEventFromLuma`); cookie sign/verify round-trip and tamper rejection;
  booking grouping/formatting helpers; status→pill mapping.
- Keep existing suite green.

## File structure (planned)

- `middleware.ts` — route guard.
- `lib/auth/session.ts` — cookie sign/verify (Web Crypto).
- `lib/db/hub-queries.ts` — read-only aggregate reads for the dashboard.
- `app/login/page.tsx`, `app/api/hub/login/route.ts`.
- `app/add-event/page.tsx`, `app/api/hub/add-event/route.ts`.
- `app/(dashboard)/page.tsx` + tab components under `app/(dashboard)/` or
  `components/hub/` (Bookings/Slots/Events tables, sync strip, filter chips,
  search, tab bar, status pill).
- `tailwind.config.ts`, `postcss.config.js`, updated `app/globals.css`.
