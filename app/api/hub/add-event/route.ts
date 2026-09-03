import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { verifyFormToken } from "@/lib/auth/form-token";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { registerEventFromLuma, CalendarNotConnectedError } from "@/lib/events/register";
import { lookupChannelIdByName } from "@/lib/slack/api";
import { setCityChannelName } from "@/lib/db/slack";
import { resolveNewCalendarEvent, resolveCalendarSlug, CalendarSlugTakenError } from "@/lib/events/onboard";
import { upsertLumaCalendar } from "@/lib/db/luma-calendars";
import { __bustCalendarCache } from "@/lib/luma/calendars";
import { LumaUrlUnresolvedError, LumaApiKeyInvalidError } from "@/lib/luma/client";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Adding an event is public (form-token). Connecting a NEW calendar writes
 * credentials into the registry, so it additionally requires an operator login. */
async function operatorAuthed(): Promise<boolean> {
  const secret = process.env.HUB_SESSION_SECRET;
  if (!secret) return false;
  return isValidSession((await cookies()).get(SESSION_COOKIE)?.value, secret);
}

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
  const calendarUrl = String(form.get("calendarUrl") ?? "").trim() || undefined;
  const calendarApiKey = String(form.get("calendarApiKey") ?? "").trim() || undefined;
  const calendarWebhookSecret = String(form.get("calendarWebhookSecret") ?? "").trim() || undefined;
  const calendarSlug = String(form.get("calendarSlug") ?? "").trim() || undefined;

  // The event's own public page — preserve the vanity link the operator pasted.
  // Distinct from calendarUrl (the calendar's "follow" page, stored on the calendar row).
  const eventPublicUrl = /^https?:\/\//i.test(lumaEvent) ? lumaEvent : undefined;

  try {
    let registerInput: { lumaEvent: string; publicUrl?: string } = { lumaEvent, publicUrl: eventPublicUrl };

    // New calendar path: user supplied a key for an unconnected calendar. This
    // writes credentials into the registry, so it requires an operator login
    // (adding events to already-connected calendars stays public).
    if (calendarApiKey) {
      if (!(await operatorAuthed())) {
        return NextResponse.json({
          ok: false,
          error: "Connecting a new calendar requires an operator login — ask Nancy Chen, or pre-register it at /add-calendar.",
        }, { status: 401 });
      }
      if (!calendarUrl) {
        return NextResponse.json({ ok: false, error: "A Luma calendar URL is required to connect a new calendar." }, { status: 400 });
      }
      if (!calendarWebhookSecret) {
        return NextResponse.json({ ok: false, error: "A webhook signing secret is required to connect a new calendar (enables live guest sync)." }, { status: 400 });
      }
      const resolved = await resolveNewCalendarEvent({ lumaEvent, apiKey: calendarApiKey });
      const id = await resolveCalendarSlug(calendarSlug ?? "", resolved.city, resolved.calendarId);
      await upsertLumaCalendar({
        id,
        apiKey: calendarApiKey,
        webhookSecret: calendarWebhookSecret ?? null,
        calendarId: resolved.calendarId,
        city: resolved.city,
        calendarUrl,
      });
      __bustCalendarCache();
      registerInput = { ...registerInput, lumaEvent: resolved.eventId, publicUrl: eventPublicUrl };
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
    if (err instanceof CalendarSlugTakenError) {
      return NextResponse.json({ ok: false, needsCalendar: true, error: err.message }, { status: 400 });
    }
    if (err instanceof LumaApiKeyInvalidError) {
      return NextResponse.json({ ok: false, needsCalendar: true, error: "That Luma API key isn't valid — copy it from the calendar's Settings → Options → Luma API." }, { status: 400 });
    }
    console.error("[add-event] register failed", err);
    const raw = err instanceof Error ? err.message : "";
    // Surface the actual, actionable reason (these guard messages are safe — no
    // secrets/internals) instead of a blanket "check the URL" that hides the cause.
    let msg = "Couldn't add that event — check the Luma event URL (the top field) and try again.";
    if (/can't see this event/i.test(raw)) {
      msg = raw; // wrong calendar key, or the event isn't upcoming
    } else if (/no city|no address/i.test(raw)) {
      msg = "This Luma event has no location set, so we can't tell which city it's in. Add a venue/address to the event in Luma, then try again.";
    } else if (/no timezone/i.test(raw)) {
      msg = "This Luma event has no timezone set in Luma. Set the event date/time (which sets its timezone), then try again.";
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
