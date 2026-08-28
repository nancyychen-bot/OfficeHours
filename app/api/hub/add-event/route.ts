import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyFormToken } from "@/lib/auth/form-token";
import { registerEventFromLuma } from "@/lib/events/register";
import { lookupChannelIdByName } from "@/lib/slack/api";
import { setCityChannelName } from "@/lib/db/slack";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  if (!(await verifyFormToken(token, env.hub.sessionSecret(), Date.now()))) {
    return NextResponse.json({ ok: false, error: "Invalid or expired form token. Reload the page and try again." }, { status: 400 });
  }

  const lumaEvent = String(form.get("lumaEvent") ?? "").trim();
  if (!lumaEvent) {
    return NextResponse.json({ ok: false, error: "A Luma event URL or id is required." }, { status: 400 });
  }
  const slackChannel = String(form.get("slackChannel") ?? "").trim();
  if (!slackChannel) {
    return NextResponse.json({ ok: false, error: "A Slack channel is required." }, { status: 400 });
  }
  const city = String(form.get("city") ?? "").trim() || undefined;
  const slotStart = String(form.get("slotStart") ?? "").trim() || undefined;
  const lengthRaw = String(form.get("length") ?? "").trim();
  const slotLengthMinutes = lengthRaw ? Number(lengthRaw) : undefined;

  try {
    const result = await registerEventFromLuma({ lumaEvent, city, slotStart, slotLengthMinutes });
    // Attach the channel to the event's city (best-effort; never fails the add).
    // Surface a warning when the channel isn't actually postable yet, so a new
    // city isn't silently saved unpostable (green success, no recruit posts).
    let warning: string | undefined;
    if (result.city) {
      try {
        const channelId = await lookupChannelIdByName(slackChannel);
        await setCityChannelName({ city: result.city, channelName: slackChannel, channelId });
        if (!channelId) {
          warning = `Event added, but the Slack channel "${slackChannel}" couldn't be resolved — invite @build_bar_bot to it, then run the channel-id backfill (or set a webhook_url). Until then, recruit posts for ${result.city} won't send.`;
        }
      } catch (chErr) {
        console.error("[add-event] channel save failed", chErr);
        warning = `Event added, but attaching the Slack channel failed — configure the channel for ${result.city} manually so recruit posts can send.`;
      }
    }
    return NextResponse.json({
      ok: true,
      ...(warning ? { warning } : {}),
      event: {
        name: result.eventName,
        slots: result.inserted + result.updated,
        importedGuests: result.importedGuests,
      },
    });
  } catch (err) {
    // This route is public + embeddable — don't echo raw internal/upstream
    // error text (Luma API details, DB messages) to anonymous callers. Log the
    // real error server-side; return a generic, actionable message.
    console.error("[add-event] register failed", err);
    return NextResponse.json(
      { ok: false, error: "Couldn't add that event. Check the Luma URL and try again." },
      { status: 400 },
    );
  }
}
