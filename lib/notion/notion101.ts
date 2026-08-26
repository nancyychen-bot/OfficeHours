import { getNotionClient } from "./client";

/**
 * "Code becomes the agent" for event/date/location on guest feedback.
 *
 * Feedback carries only the respondent's email. Build Bar attendees resolve via
 * the hub's Supabase bookings; everyone else (Notion 101, etc.) lives in the
 * "Notion 101 Guest Database" in the dev workspace. We read that data source
 * directly and match on email → event name, date, and location.
 *
 * Data-source id is pinned here (same convention as FEEDBACK_DEV_DS). If the DB
 * is recreated, update this constant.
 */
export const NOTION_101_GUEST_DS = "3c7b35e6-e67f-805f-834f-000b61e0cd8a";

// Property names, pinned from the live "Notion 101 Guest Database" schema.
const P = {
  email: "Email",
  notionEmail: "Notion Account Email",
  event: "Event",
  eventDate: "Event Date",
  location: "Location", // a full street address (rich_text)
} as const;

export interface Notion101Candidate {
  eventDate: string; // ISO "YYYY-MM-DD"
  city: string | null; // parsed from the address
  event: string | null;
}

/**
 * Best-effort city from a full street address, e.g.
 * "75 Varick St, New York, NY 10013, USA" → "New York". Keeps the feedback
 * Location select clean and consistent with Build Bar city options. Falls back
 * to the whole string when it can't parse a US "…, City, ST ZIP, …" shape.
 */
export function cityFromAddress(address: string | null | undefined): string | null {
  const s = (address ?? "").trim();
  if (!s) return null;
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return s;
  // The "ST ZIP" segment (e.g. "NY 10013" / "CA 95014-2083"); city is right before it.
  const stateIdx = parts.findIndex((p) => /^[A-Z]{2}\s+\d{5}(-\d{4})?$/.test(p));
  if (stateIdx > 0) return parts[stateIdx - 1];
  return parts[1] ?? s; // "street, city, …" fallback
}

/**
 * Classify an event by its name into the feedback "Event" select label. Build Bar
 * hub events read "Notion Build Bar …"; Notion 101 events read "Notion 101 …". The
 * Notion 101 Guest DB can hold either, so we key off the name (default Notion 101).
 */
export function eventTypeLabel(name: string | null | undefined): "Build Bar" | "Notion 101" {
  return /build\s*bar/i.test(name ?? "") ? "Build Bar" : "Notion 101";
}

/** Pure: most recent candidate dated on/before submission. Null if none qualify. */
export function selectNotion101Event(
  candidates: Notion101Candidate[],
  submittedAtISO: string,
): Notion101Candidate | null {
  const sub = submittedAtISO.slice(0, 10);
  const eligible = candidates.filter((c) => c.eventDate && c.eventDate <= sub);
  if (eligible.length === 0) return null;
  return eligible.reduce((a, b) => (b.eventDate > a.eventDate ? b : a));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function richText(p: any): string | null {
  if (!p) return null;
  const arr = p.type === "rich_text" ? p.rich_text : p.type === "title" ? p.title : null;
  if (!arr) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = (arr as any[]).map((t) => t.plain_text ?? "").join("");
  return s || null;
}

/**
 * Look up a feedback respondent in the Notion 101 Guest Database by email (or
 * Notion account email) and return the most recent event on/before submission.
 * Best-effort: returns null on any error so it never breaks feedback processing.
 */
export async function findNotion101Event(
  email: string,
  submittedAtISO: string,
): Promise<Notion101Candidate | null> {
  const wanted = email.trim();
  if (!wanted) return null;
  const sub = submittedAtISO.slice(0, 10);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notion = getNotionClient("dev") as any;
    const res = await notion.dataSources.query({
      data_source_id: NOTION_101_GUEST_DS,
      filter: {
        and: [
          {
            or: [
              { property: P.email, email: { equals: wanted } },
              { property: P.notionEmail, email: { equals: wanted } },
            ],
          },
          { property: P.eventDate, date: { on_or_before: sub } },
        ],
      },
      page_size: 25,
    });
    const candidates: Notion101Candidate[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of (res.results ?? []) as any[]) {
      const props = row.properties ?? {};
      const eventDate = props[P.eventDate]?.date?.start?.slice(0, 10);
      if (!eventDate) continue;
      candidates.push({
        eventDate,
        city: cityFromAddress(richText(props[P.location])),
        event: richText(props[P.event]),
      });
    }
    return selectNotion101Event(candidates, submittedAtISO);
  } catch {
    return null;
  }
}
