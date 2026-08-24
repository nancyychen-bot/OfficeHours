# Auto-Resolve Slack `channel_id` at Setup + Backfill — Design

**Date:** 2026-08-24
**Status:** Draft (awaiting user review)

## Problem

`slack_channels` rows store a webhook URL and a channel *name* but often no
`channel_id`. The guest-cancel "replace your booking" DM (and any future feature)
can only render a clickable `<#channel>` mention when `channel_id` is present —
otherwise it falls back to a generic text nudge. A Slack incoming-webhook URL does
**not** contain the channel's `C…` id, so it can't be derived from existing config.

## Goal

1. **Auto-resolve** `channel_id` from the channel *name* (via the Slack API) when a
   city channel is saved in the hub, so it's captured once at setup and never drifts.
2. **Backfill** the existing rows that are missing `channel_id`, using the same
   resolution, so the DM links light up immediately.

Done as one piece (shared resolution helper).

## Components

### 1. `lookupChannelIdByName(name)` — `lib/slack/api.ts`
A new exported helper alongside `lookupUserByEmail`/`openDM`, built on the existing
private `callSlack`:
- Calls `conversations.list` with `types=public_channel,private_channel`,
  `exclude_archived=true`, `limit=200`, paginating via
  `response_metadata.next_cursor` until a match or no more pages.
- Normalizes by stripping a leading `#` from the query and each channel's `name`;
  matches case-insensitively.
- Returns the `C…` id, or `null` (not found / `missing_scope` / any error).
  Best-effort — `callSlack` already logs failures via `sync_log`.
- Safety cap on pages (e.g. 20) so a huge workspace can't loop unbounded.

### 2. Auto-resolve on save — `app/api/hub/slack/route.ts` (`action=save`)
When saving a channel:
- If `body.channelId` is explicitly provided (non-empty), use it (manual override
  wins).
- Else, if a `channelName` is present, call `lookupChannelIdByName(channelName)` and
  persist the result (`C…` or `null`).
- Resolution failure never fails the save — it stores `null` (current behavior).

So every city added/edited going forward auto-fills `channel_id` from its name.

### 3. Backfill — `scripts/backfill-slack-channel-ids.ts`
- Reads all channels via `listSlackChannels()`.
- For each row **missing** `channelId` but **having** a `channelName`, resolve via
  `lookupChannelIdByName` and update with a new targeted helper
  `setSlackChannelId(city, channelId)` in `lib/db/slack.ts`.
- Idempotent: skips rows that already have an id; prints resolved / unresolved per
  city and a summary count.
- npm script: `"backfill:slack-ids": "tsx --env-file=.env.local scripts/backfill-slack-channel-ids.ts"`.

## Key dependency / risk (verify at rollout)

`conversations.list` requires the Slack app to have **`channels:read`** (public
channels). For **private** channels it also needs **`groups:read`** *and* the bot to
be a member. If the scope is missing, every lookup returns `null` gracefully — the
save still works and the DM keeps its text fallback — but nothing fills in.

**Rollout verify step:** run `npm run backfill:slack-ids`. If it resolves 0 of N
channels, the scope is missing → add `channels:read` (and `groups:read` if the
`#build-bar-*` channels are private) in the Slack app config, reinstall, and re-run.
The backfill is safe to re-run any number of times.

## Testing

- `lookupChannelIdByName`: with a mocked `callSlack`/fetch — matches by name ignoring
  a leading `#` and case; walks pagination via `next_cursor`; returns `null` when not
  found and when the API returns an error/`missing_scope`; respects the page cap.
- Save-action auto-resolve: resolves from `channelName` when `channelId` is empty;
  respects an explicitly-provided `channelId`; stores `null` (and still succeeds) when
  resolution fails. (Tested at the resolution-decision layer; the route handler itself
  follows the codebase convention of not being module-mocked.)

## Rollout

1. Deploy code.
2. Run `npm run backfill:slack-ids`; confirm it resolves the existing city channels.
3. If it resolves 0, add the Slack scope(s), reinstall the app, re-run.
4. New channels added via Settings → Slack auto-fill `channel_id` from then on.

## Open risks

- Private `#build-bar-*` channels need `groups:read` + bot membership; public need
  only `channels:read`. Public/private status unconfirmed — the code handles both;
  the scope config is the operational dependency.
- Channel renamed in Slack after setup → stored `channel_id` still valid (ids are
  stable), but `channelName` could drift; out of scope (ids don't change on rename).
