import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyFormToken } from "@/lib/auth/form-token";
import { registerEventFromLuma, CalendarNotConnectedError } from "@/lib/events/register";
import { lookupChannelIdByName } from "@/lib/slack/api";
import { setCityChannelName } from "@/lib/db/slack";
import { resolveNewCalendarEvent, deriveCalendarId } from "@/lib/events/onboard";
import { upsertLumaCalendar, getLumaCalendarByCalendarId } from "@/lib/db/luma-calendars";
import { __bustCalendarCache } from "@/lib/luma/calendars";
import { LumaUrlUnresolvedError } from "@/lib/luma/client";

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

  const calendarUrl = String(form.get("calendarUrl") ?? "").trim() || undefined;
  const calendarApiKey = String(form.get("calendarApiKey") ?? "").trim() || undefined;
  const calendarWebhookSecret = String(form.get("calendarWebhookSecret") ?? "").trim() || undefined;
  const calendarSlug = String(form.get("calendarSlug") ?? "").trim() || undefined;

  try {
    let registerInput: { lumaEvent: string; city?: string; slotStart?: string; slotLengthMinutes?: number; publicUrl?: string } = { lumaEvent, city, slotStart, slotLengthMinutes };

    // New calendar path: user supplied a key for an unconnected calendar.
    if (calendarApiKey) {
      const resolved = await resolveNewCalendarEvent({ lumaEvent, apiKey: calendarApiKey });
      // Reuse an existing row for the same Luma calendar (dedupe by cal- id) so a
      // re-connect updates that calendar's credentials instead of creating a
      // divergent slug; otherwise derive a stable, non-empty slug.
      const existing = resolved.calendarId ? await getLumaCalendarByCalendarId(resolved.calendarId) : null;
      const id = existing?.id ?? deriveCalendarId(calendarSlug, resolved.city, resolved.calendarId);
      await upsertLumaCalendar({
        id,
        apiKey: calendarApiKey,
        webhookSecret: calendarWebhookSecret ?? null,
        calendarId: resolved.calendarId,
        city: resolved.city,
        calendarUrl: calendarUrl ?? null,
      });
      __bustCalendarCache();
      registerInput = { ...registerInput, lumaEvent: resolved.eventId, publicUrl: calendarUrl ?? undefined };
    }

    const result = await registerEventFromLuma(registerInput);

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
      event: { name: result.eventName, slots: result.inserted + result.updated, importedGuests: result.importedGuests },
    });
  } catch (err) {
    if ((err instanceof CalendarNotConnectedError || err instanceof LumaUrlUnresolvedError) && !calendarApiKey) {
      // Not an error — prompt the operator to connect this calendar.
      return NextResponse.json({
        ok: false,
        needsCalendar: true,
        error:
          "This event's Luma calendar isn't connected yet. Paste its Luma API key below to connect it (one-time), then add the event.",
      });
    }
    console.error("[add-event] register failed", err);
    const msg =
      err instanceof Error && /can't see this event/i.test(err.message)
        ? err.message // surface the actionable key-validation message verbatim
        : "Couldn't add that event. Check the Luma URL and try again.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
