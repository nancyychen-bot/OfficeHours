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
