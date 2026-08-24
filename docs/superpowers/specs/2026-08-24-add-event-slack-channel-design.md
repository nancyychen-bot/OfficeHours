# Slack Channel Field on the Add Event Form — Design

**Date:** 2026-08-24
**Status:** Draft (awaiting user review)

## Goal

When adding an event, the operator enters the event's **Slack channel** right in the
main Add Event form. On submit, the channel is recorded for the event's **city**
(channel name + auto-resolved `channel_id`), so the guest-cancel DM's `#`-mention and
recruit routing know where to point. Webhooks remain a per-city manual step.

## Decisions (confirmed with user)

- The **Slack channel field is required** — you can't add an event without it.
- **Webhook is per-city, not per-event, and may be empty** until wired by hand. A
  city's channel row can exist with just a name (+ id); an empty webhook means "not
  set up yet." Stored as an **empty string** (no schema migration — `webhook_url` is
  non-null but `''` is valid).
- Adding an event **never overwrites** a webhook a city already has.

## Components

### 1. Form — `components/hub/AddEventForm.tsx`
Add a **required** text input **"Slack channel"** to the **main** form (below the Luma
URL, above the Add button — NOT inside "Optional overrides"). Placeholder
`#build-bar-nyc`. Client-side required (submit disabled / blocked when blank). Submits
as `slackChannel`.

### 2. Register returns the city — `lib/events/register.ts`
Add `city` to `RegisterResult` (the function already computes it) so the route knows
which city to attach the channel to.

### 3. Route — `app/api/hub/add-event/route.ts`
Read `slackChannel` from the form; if blank → 400 (required). After
`registerEventFromLuma(...)` returns, call `setCityChannelName({ city: result.city,
channelName: slackChannel })`.

### 4. DB helper — `lib/db/slack.ts`
`setCityChannelName({ city, channelName })`:
- resolve `channelId` via `lookupChannelIdByName(channelName)` (best-effort → null),
- read the city's existing row; **preserve its `webhook_url`** if present, else `''`,
- upsert the row (keyed on city) with the new `channel_name` + resolved `channel_id`,
  leaving `aliases` untouched (preserve existing).

### 5. Posting guard
`getSlackChannelForCity` may now return a row with `webhookUrl = ''`. Guard the
webhook-post path (recruit posts) to **no-op when the webhook is empty**, so a
name-only city never triggers a broken POST. The `channel_id` still powers the DM
`#`-mention.

## Notes / dependencies

- **`channel_id` resolution needs the Slack `channels:read` scope**, which is currently
  missing (see the pending scope request). Until granted, `setCityChannelName` stores
  the **name** with a null `channel_id`; re-saving (or the `backfill:slack-ids` script)
  fills the id once the scope lands. The name is captured regardless.
- No migration. No change to the per-city routing model.

## Testing
- `setCityChannelName` preserve-webhook behavior — the decision (keep existing webhook,
  else `''`) is the load-bearing bit; cover it if cleanly testable, else verify via
  the rollout. (Follows the codebase's "test the pure bits" convention; the route +
  form are integration-verified.)
- Posting guard: an empty webhook no-ops (extend the existing recruit/slack test if one
  covers the webhook path).

## Rollout
1. Deploy. 2. Add an event with a channel → confirm the city's `slack_channels` row gets
the name (+ id once the scope is live). 3. Webhooks stay a one-time per-city step in
Settings → Slack.
