import { listUpcomingCalendarEvents } from "../luma/client";

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
