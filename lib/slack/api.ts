import { env } from "../env";
import { logSync } from "../sync/log";

export interface SlackResult {
  ok: boolean;
  ts?: string;
  error?: string;
}

const SLACK_API = "https://slack.com/api";

/**
 * Low-level authed POST to a Slack Web API method. Returns the parsed body or a
 * soft failure. Most methods take a JSON body, but a few (notably
 * `users.lookupByEmail`) only read `application/x-www-form-urlencoded` params and
 * silently ignore a JSON body — pass `form: true` for those.
 */
async function callSlack(
  method: string,
  payload: Record<string, unknown>,
  form = false,
): Promise<Record<string, unknown>> {
  const token = env.slack.botToken();
  if (!token) return { ok: false, error: "no_bot_token" };
  try {
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      body: form
        ? new URLSearchParams(payload as Record<string, string>).toString()
        : JSON.stringify(payload),
      // Cap latency: a hung Slack call must not blow the interactivity 3s ack budget.
      signal: AbortSignal.timeout(2500),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!body.ok) {
      await logSync({ direction: "luma_in", result: "error", action: `slack_${method}`, note: String(body.error ?? "unknown") });
    }
    return body;
  } catch (err) {
    await logSync({ direction: "luma_in", result: "error", action: `slack_${method}`, note: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: "network" };
  }
}

/** Slack user id for an email, or null (not found / not in workspace / no token). */
export async function lookupUserByEmail(email: string): Promise<string | null> {
  // users.lookupByEmail only reads form-encoded params, not a JSON body.
  const body = await callSlack("users.lookupByEmail", { email }, true);
  const user = body.user as { id?: string } | undefined;
  return body.ok && user?.id ? user.id : null;
}

/** DM channel id for a user id, or null. */
export async function openDM(userId: string): Promise<string | null> {
  const body = await callSlack("conversations.open", { users: userId });
  const channel = body.channel as { id?: string } | undefined;
  return body.ok && channel?.id ? channel.id : null;
}

/**
 * The Slack channel id (C…) for a PUBLIC channel name, or null. Walks
 * conversations.list, matching the name case-insensitively and ignoring a leading
 * "#". Best-effort: null on not-found / missing scope / error.
 *
 * Public channels only: including `private_channel` in `types` makes Slack reject
 * the whole call with `missing_scope` unless the app also has `groups:read` — and
 * the Build Bar city channels are public. conversations.list is a read method —
 * pass params form-encoded (like lookupByEmail).
 */
export async function lookupChannelIdByName(name: string | null | undefined): Promise<string | null> {
  const needle = (name ?? "").trim().replace(/^#/, "").toLowerCase();
  if (!needle) return null;
  let cursor: string | undefined;
  // Large orgs (Notion's workspace has ~10k+ public channels) blow past a small
  // cap, so page at Slack's max (1000) and allow enough pages to cover the whole
  // workspace. We stop the moment the name matches, so this only pages fully on a
  // genuine miss.
  for (let page = 0; page < 50; page++) {
    const params: Record<string, string> = {
      types: "public_channel",
      exclude_archived: "true",
      limit: "1000",
    };
    if (cursor) params.cursor = cursor;
    const body = await callSlack("conversations.list", params, true);
    if (!body.ok) return null;
    const channels = (body.channels as Array<{ id?: string; name?: string }> | undefined) ?? [];
    const match = channels.find((c) => (c.name ?? "").toLowerCase() === needle);
    if (match?.id) return match.id;
    const meta = body.response_metadata as { next_cursor?: string } | undefined;
    cursor = meta?.next_cursor || undefined;
    if (!cursor) return null; // exhausted all pages → genuinely not found
  }
  // Fell out of the loop with pages still remaining: hit the 50-page cap.
  await logSync({
    direction: "luma_in",
    result: "error",
    action: "slack_conversations.list",
    note: `channel "${needle}" not found within the page cap`,
  });
  return null;
}

/**
 * The channel_id to store when saving a city channel: an explicitly provided id
 * wins; otherwise resolve it from the channel name via Slack. Null if neither yields
 * one. Best-effort (never throws) — a save must succeed even if resolution fails.
 */
export async function resolveChannelIdForSave(
  explicitId: string | null | undefined,
  channelName: string | null | undefined,
): Promise<string | null> {
  const id = (explicitId ?? "").trim();
  if (id) return id;
  return lookupChannelIdByName(channelName);
}

/** Have the bot join a public channel (a prerequisite for posting). Best-effort:
 * returns false on any error (e.g. the app lacks the channels:join scope, or the
 * channel is private). */
export async function joinChannel(channelId: string): Promise<boolean> {
  const body = await callSlack("conversations.join", { channel: channelId });
  return !!body.ok;
}

/** Post Block Kit blocks to a channel/DM id. Best-effort. */
export async function postToChannel(channel: string, blocks: unknown[], text: string): Promise<SlackResult> {
  const body = await callSlack("chat.postMessage", { channel, blocks, text });
  return { ok: !!body.ok, ts: body.ts as string | undefined, error: body.error as string | undefined };
}

/** Update an existing message (used by the interactivity handler to confirm a choice). */
export async function updateMessage(channel: string, ts: string, blocks: unknown[], text: string): Promise<SlackResult> {
  const body = await callSlack("chat.update", { channel, ts, blocks, text });
  return { ok: !!body.ok, error: body.error as string | undefined };
}

/** Open a modal from a trigger id. Best-effort. */
export async function openModal(triggerId: string, view: unknown): Promise<SlackResult> {
  const body = await callSlack("views.open", { trigger_id: triggerId, view });
  return { ok: !!body.ok, error: body.error as string | undefined };
}

/** Convenience: email → user → DM → post. Best-effort; ok:false if any step fails. */
export async function dmByEmail(email: string, blocks: unknown[], text: string): Promise<SlackResult> {
  if (!env.slack.botToken()) return { ok: false, error: "no_bot_token" };
  const userId = await lookupUserByEmail(email);
  if (!userId) return { ok: false, error: "user_not_found" };
  const dm = await openDM(userId);
  if (!dm) return { ok: false, error: "dm_open_failed" };
  return postToChannel(dm, blocks, text);
}
