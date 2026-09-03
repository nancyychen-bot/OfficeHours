import { listUpcomingCalendarEvents } from "../luma/client";
import { upsertLumaCalendar, getLumaCalendarByCalendarId } from "../db/luma-calendars";
import { __bustCalendarCache } from "../luma/calendars";

/** The slug of a Luma URL = its last path segment, lowercased. */
function slug(u: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    const seg = url.pathname.split("/").filter(Boolean).pop();
    return seg ? seg.toLowerCase() : null;
  } catch {
    return null;
  }
}

export interface OnboardResolution {
  eventId: string;
  calendarId: string | null;
  city: string | null;
  apiKey: string;
}

/**
 * Derive a stable, URL-safe calendar id (slug, = `events.luma_calendar`) from the
 * preferred inputs in order. Normalizes each candidate BEFORE falling back, so a
 * value that normalizes to empty (e.g. "!!!", non-ASCII) doesn't win over a usable
 * later one and produce an unlookupable empty-string primary key. Always non-empty.
 */
export function deriveCalendarId(...parts: Array<string | null | undefined>): string {
  const norm = (s: string | null | undefined) =>
    (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  for (const p of parts) {
    const n = norm(p);
    if (n) return n;
  }
  return "calendar";
}

/**
 * Validate a pasted Luma API key against the event being added: list the key's
 * upcoming events and match by evt- id (if the input contains one) or vanity slug.
 * Returns the evt- id, the owning cal- id, and the event's city — all from the
 * authenticated API, so it doubles as proof the key is correct.
 */
export async function resolveNewCalendarEvent(input: { lumaEvent: string; apiKey: string }): Promise<OnboardResolution> {
  const wantedId = input.lumaEvent.match(/evt-[A-Za-z0-9]+/)?.[0] ?? null;
  const wantedSlug = slug(input.lumaEvent);
  const events = await listUpcomingCalendarEvents(input.apiKey);
  const match = events.find(
    (e) => (wantedId && e.id === wantedId) || (wantedSlug && e.url && slug(e.url) === wantedSlug),
  );
  if (!match) {
    throw new Error(
      "That API key can't see this event — check you copied the right calendar's key and that the event is upcoming.",
    );
  }
  return { eventId: match.id, calendarId: match.calendarId, city: match.city, apiKey: input.apiKey };
}

export interface ConnectCalendarInput {
  slug: string;
  apiKey: string;
  webhookSecret: string;
  calendarUrl: string;
  city?: string;
}

/**
 * Connect a Luma calendar WITHOUT an event (standalone /add-calendar). Validates
 * the key by listing the calendar's events — an empty list from a valid key still
 * confirms it — then derives the `cal-` id from the calendar URL (`.../cal-…`) or,
 * failing that, the first upcoming event, and upserts the row. Deduped by `cal-`
 * id so re-adding a calendar updates it. Throws if Luma rejects the key.
 */
export async function connectCalendar(
  input: ConnectCalendarInput,
): Promise<{ id: string; calendarId: string | null; city: string | null }> {
  let events: Awaited<ReturnType<typeof listUpcomingCalendarEvents>>;
  try {
    events = await listUpcomingCalendarEvents(input.apiKey);
  } catch {
    throw new Error("That Luma API key isn't valid — copy it from the calendar's Settings → Options → Luma API.");
  }
  const calFromUrl = input.calendarUrl.match(/cal-[A-Za-z0-9]+/)?.[0] ?? null;
  const calendarId = calFromUrl ?? events[0]?.calendarId ?? null;
  const city = input.city?.trim() || events[0]?.city || null;
  const existing = calendarId ? await getLumaCalendarByCalendarId(calendarId) : null;
  const id = existing?.id ?? deriveCalendarId(input.slug, city, calendarId);
  await upsertLumaCalendar({ id, apiKey: input.apiKey, webhookSecret: input.webhookSecret, calendarId, city, calendarUrl: input.calendarUrl });
  __bustCalendarCache();
  return { id, calendarId, city };
}
