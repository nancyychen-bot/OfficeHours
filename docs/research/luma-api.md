# Luma API & Webhooks — Reference for the Sync Engine

Verified against Luma's live OpenAPI 3.1 spec (`public-api.luma.com/openapi.json`) +
official docs, 2026-07-29. Drives `lib/luma/*`.

## Plan & auth
- **Requires Luma Plus** for BOTH API and webhooks, active **on the specific calendar**
  (API keys are per-calendar). ~$59/mo annual.
- Base URL: `https://public-api.luma.com`. Auth header: **`x-luma-api-key: <key>`** (not Bearer).
- Rate limit: 200 req/min per calendar key (429 + `Retry-After`).

## Webhook events (exact enum)
```
guest.registered   guest.updated   ticket.registered
event.created  event.updated  event.canceled
calendar.event.added  calendar.event.submitted  calendar.person.subscribed  *
```
**There is NO `guest.checked_in`.** Check-in arrives via **`guest.updated`**.

## Envelope + guest payload
Body = `{ type, data }`. `guest.registered` and `guest.updated` share an identical `data`
shape — **read `type`, don't infer from shape.**
```jsonc
{ "type": "guest.updated", "data": {
  "id": "gst-xxxx",              // STABLE guest id — key on this
  "user_id": "usr-xxxx",
  "user_email": "a@b.com",
  "user_name": null, "user_first_name": null, "user_last_name": null,
  "phone_number": null,
  "approval_status": "approved",
  "registration_answers": [ { "label","question_id","question_type","value" } ],
  "event_tickets": [ { "checked_in_at": null /* ISO | null, PER-TICKET */ } ],
  "event": { "id":"evt-xxxx", "calendar_id":"cal-xxxx", "name","start_at","end_at","timezone" }
}}
```
- Name: prefer `user_name`, else `user_first_name`+`user_last_name`. Email `user_email`. Phone `phone_number`.
- **Event id lives at `data.event.id`** (evt-…) — there is NO top-level event id. Route on this → our `events.luma_event_id`.
- **Check-in = any `data.event_tickets[].checked_in_at` non-null** (per-ticket; NOT `data.checked_in_at`).

## Custom registration answers
`data.registration_answers[]` — each `{ label, question_id, question_type, value }`.
- Map via `question_id` (ids from Get Event `registration_questions`, host-only). Until the
  form is locked we heuristically match on `label` + `question_type` (see `lib/luma/parse.ts`).
- `question_type`: `text`, `long-text`, `url`, `dropdown`, `phone-number`, `agree-check`,
  `terms`, `company` (`value`={company, job_title}), `multi-select` (value=string[]), socials.
- `registration_answers` can be **`null`** (not `[]`) when no custom questions.

## Signature verification (inbound)
Headers: `Webhook-Signature: t=<ts>,v1=<sig>`, `Webhook-Id`, `Webhook-Timestamp`. Secret `whsec_…`.
1. Parse `t`, `v1` from `Webhook-Signature`.
2. signed = **`{t}.{rawBody}`** (raw JSON body, before parse).
3. `HMAC-SHA256(signed, secret)` → **hex**; constant-time compare to `v1`.
⚠️ NOT the Svix `{id}.{t}.{body}` triple — Luma signs `{t}.{body}` and emits hex.

## Delivery behavior
Respond **2xx within 5s** or Luma retries (3×, 1/2/4 min backoff). `410 Gone` auto-pauses the
webhook. Duplicates possible → **idempotent** handlers (we key on `gst-` id + hub upsert).

## Endpoints we may use (reconciliation)
- `GET /v1/events/guests/list?event_id=evt-…` (cursor: `pagination_cursor`/`pagination_limit`
  → `entries`/`has_more`/`next_cursor`)
- `GET /v1/event/get`, `GET /v1/calendars/events/list`, `POST /v2/webhooks/create`

## Sources
docs.luma.com/reference/* · help.luma.com/p/webhooks · public-api.luma.com/openapi.json
