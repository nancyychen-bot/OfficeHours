import { getAdminClient } from "../supabase/admin";
import { lumaCalendars } from "../luma/calendars";
import { listUpcomingCalendarEvents } from "../luma/client";

export interface UntrackedEvent {
  eventId: string; // evt-…
  name: string | null;
  guestCount: number;
  sampleGuest: string | null;
  lastSeen: string; // ISO
}

/** Our events on the shared calendars are named "… Build Bar …" / "Office Hours".
 * Everything else (Tech Week, AI Labs, Notion 101…) is expected to be untracked,
 * so we don't alert on it. */
export function isOurEventName(name: string | null | undefined): boolean {
  return !!name && /build\s*bar|office\s*hours/i.test(name);
}

/** Parse a `unknown_event` sync-log note:
 * "not a registered Notion Build Bar event (evt-…) — guest NAME <email>". Pure. */
export function parseUnknownEventNote(note: string): {
  eventId: string | null;
  guestName: string | null;
  guestEmail: string | null;
} {
  return {
    eventId: note.match(/evt-[A-Za-z0-9]+/)?.[0] ?? null,
    guestName: note.match(/guest (.+?) </)?.[1]?.trim() ?? null,
    guestEmail: note.match(/<([^>]+)>/)?.[1]?.trim() ?? null,
  };
}

/**
 * Events that have received Luma registrations but aren't tracked in the hub
 * (their webhooks were dropped as `unknown_event`). Excludes any event that has
 * since been registered. Sorted by how many guests were dropped.
 */
export async function listUntrackedEvents(withinDays = 30): Promise<UntrackedEvent[]> {
  const supabase = getAdminClient();

  const { data: tracked } = await supabase.from("events").select("luma_event_id");
  const trackedIds = new Set((tracked ?? []).map((r) => r.luma_event_id).filter(Boolean));

  const since = new Date(Date.now() - withinDays * 86_400_000).toISOString();
  const { data: logs } = await supabase
    .from("sync_log")
    .select("note, created_at")
    .eq("action", "unknown_event")
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  const byEvent = new Map<string, { guests: Set<string>; sample: string | null; lastSeen: string }>();
  for (const l of logs ?? []) {
    const { eventId, guestName, guestEmail } = parseUnknownEventNote((l.note as string) ?? "");
    if (!eventId || trackedIds.has(eventId)) continue;
    const entry = byEvent.get(eventId) ?? { guests: new Set<string>(), sample: null, lastSeen: l.created_at as string };
    if (guestEmail) entry.guests.add(guestEmail.toLowerCase());
    if (!entry.sample && guestName) entry.sample = guestName;
    byEvent.set(eventId, entry);
  }
  if (byEvent.size === 0) return [];

  // Resolve event names from the connected calendars so we can keep only OUR
  // events (Build Bar / Office Hours) and ignore the many other events people
  // register for on the shared calendars.
  const nameById = new Map<string, string>();
  for (const cal of await lumaCalendars()) {
    try {
      for (const e of await listUpcomingCalendarEvents(cal.apiKey)) {
        if (e.name) nameById.set(e.id, e.name);
      }
    } catch {
      // A calendar whose key is failing is flagged separately; skip it here.
    }
  }

  return [...byEvent.entries()]
    .map(([eventId, e]) => ({ eventId, name: nameById.get(eventId) ?? null, guestCount: e.guests.size, sampleGuest: e.sample, lastSeen: e.lastSeen }))
    .filter((u) => isOurEventName(u.name))
    .sort((a, b) => b.guestCount - a.guestCount);
}
