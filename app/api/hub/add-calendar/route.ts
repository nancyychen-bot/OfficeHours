import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyFormToken } from "@/lib/auth/form-token";
import { connectCalendar } from "@/lib/events/onboard";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Standalone calendar onboarding (the /add-calendar page) — connect a Luma
 * calendar without an event, so regions can be pre-registered in bulk. The key is
 * validated against Luma before the row is saved (fail-loud), so a bad key is
 * never stored.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  if (!(await verifyFormToken(token, env.hub.sessionSecret(), Date.now()))) {
    return NextResponse.json({ ok: false, error: "Invalid or expired form token. Reload the page and try again." }, { status: 400 });
  }

  const slug = String(form.get("slug") ?? "").trim();
  const apiKey = String(form.get("apiKey") ?? "").trim();
  const webhookSecret = String(form.get("webhookSecret") ?? "").trim();
  const calendarUrl = String(form.get("calendarUrl") ?? "").trim();
  const city = String(form.get("city") ?? "").trim() || undefined;

  const missing = ([
    ["short id", slug],
    ["Luma API key", apiKey],
    ["webhook signing secret", webhookSecret],
    ["Luma calendar URL", calendarUrl],
  ] as const).find(([, v]) => !v);
  if (missing) {
    return NextResponse.json({ ok: false, error: `A ${missing[0]} is required.` }, { status: 400 });
  }

  try {
    const result = await connectCalendar({ slug, apiKey, webhookSecret, calendarUrl, city });
    return NextResponse.json({ ok: true, calendar: { id: result.id, city: result.city, calendarId: result.calendarId } });
  } catch (err) {
    console.error("[add-calendar] connect failed", err);
    const raw = err instanceof Error ? err.message : "";
    const msg = /isn't valid/.test(raw) ? raw : "Couldn't connect that calendar. Check the API key and try again.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
