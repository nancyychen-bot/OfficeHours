import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { upsertSlackChannel, deleteSlackChannel } from "@/lib/db/slack";

export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const secret = process.env.HUB_SESSION_SECRET;
  if (!secret) return false;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSession(token, secret);
}

/**
 * Slack channel management (all require a valid hub session):
 *   action=save   — create/replace a city's channel + webhook + aliases
 *   action=delete — remove a city
 */
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { action?: string; city?: string; channelName?: string; webhookUrl?: string; aliases?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const city = (body.city ?? "").trim();
  if (!city) return NextResponse.json({ error: "City is required." }, { status: 400 });

  try {
    if (body.action === "delete") {
      await deleteSlackChannel(city);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "save") {
      const webhookUrl = (body.webhookUrl ?? "").trim();
      if (!webhookUrl.startsWith("https://hooks.slack.com/")) {
        return NextResponse.json(
          { error: "That doesn't look like a Slack webhook URL (should start with https://hooks.slack.com/)." },
          { status: 400 },
        );
      }
      const aliases = (body.aliases ?? "")
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      await upsertSlackChannel({
        city,
        channelName: (body.channelName ?? "").trim() || null,
        webhookUrl,
        aliases,
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
