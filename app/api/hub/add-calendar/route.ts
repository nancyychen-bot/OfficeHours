import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { connectCalendar, CalendarSlugTakenError } from "@/lib/events/onboard";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Standalone calendar onboarding (the /add-calendar page) — connect a Luma
 * calendar without an event, so regions can be pre-registered in bulk. Writes
 * credentials into the registry, so it requires an operator login (the page is
 * already session-guarded by middleware; this gates the route the same way). The
 * key is validated against Luma before the row is saved, so a bad key is never
 * stored.
 */
export async function POST(req: Request) {
  const secret = process.env.HUB_SESSION_SECRET;
  if (!secret || !(await isValidSession((await cookies()).get(SESSION_COOKIE)?.value, secret))) {
    return NextResponse.json({ ok: false, error: "Unauthorized — log in to the hub first." }, { status: 401 });
  }

  const form = await req.formData();
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
  // The slug is the primary key + the per-event tag; require it to contain usable
  // characters so it can't normalize to an empty/"calendar" id.
  if (!/[a-z0-9]/i.test(slug)) {
    return NextResponse.json({ ok: false, error: "The short id must contain letters or numbers (a–z, 0–9), e.g. korea." }, { status: 400 });
  }

  try {
    const result = await connectCalendar({ slug, apiKey, webhookSecret, calendarUrl, city });
    return NextResponse.json({ ok: true, calendar: { id: result.id, city: result.city, calendarId: result.calendarId } });
  } catch (err) {
    console.error("[add-calendar] connect failed", err);
    const raw = err instanceof Error ? err.message : "";
    // connectCalendar + resolveCalendarSlug throw curated, secret-free messages.
    const known = err instanceof CalendarSlugTakenError || /isn't valid|try again/.test(raw);
    const msg = known ? raw : "Couldn't connect that calendar. Check the API key and try again.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
