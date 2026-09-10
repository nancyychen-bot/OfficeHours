import { getAdminClient } from "../supabase/admin";

export interface UntrackedEvent {
  eventId: string; // evt-…
  guestCount: number;
  sampleGuest: string | null;
  lastSeen: string; // ISO
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

  return [...byEvent.entries()]
    .map(([eventId, e]) => ({ eventId, guestCount: e.guests.size, sampleGuest: e.sample, lastSeen: e.lastSeen }))
    .sort((a, b) => b.guestCount - a.guestCount);
}
