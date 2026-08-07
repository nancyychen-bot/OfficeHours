import { getAdminClient } from "../supabase/admin";
import { pushBookingToWorkspaces } from "../notion/push";
import type { Booking } from "../sync/types";

/**
 * Auto-heal drift: re-push every booking for upcoming + recent events from
 * Supabase (source of truth) to BOTH Notion cards with fullUpdate. Any manual
 * edit to a guest-info field on either card is overwritten back to canonical.
 * Workflow fields already round-trip via webhooks, so pushing their current
 * Supabase value is a no-op. Scoped to recent/future events to bound API calls.
 */
export async function reconcileCards(now: Date = new Date()): Promise<{ bookings: number; recreated: number; updated: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getAdminClient() as any;
  const cutoff = new Date(now.getTime() - 3 * 86_400_000).toISOString().slice(0, 10); // last 3 days + future
  const { data: events } = await supabase.from("events").select("id, name, city, event_date").gte("event_date", cutoff);
  const eventIds = (events ?? []).map((e: { id: string }) => e.id);
  if (!eventIds.length) return { bookings: 0, recreated: 0, updated: 0 };

  const eventMap = new Map((events ?? []).map((e: Record<string, unknown>) => [e.id, e]));
  const { data: slots } = await supabase.from("slots").select("id, name").in("event_id", eventIds);
  const slotMap = new Map((slots ?? []).map((s: Record<string, unknown>) => [s.id, s.name]));
  const { data: bookings } = await supabase.from("bookings").select("*").in("event_id", eventIds);

  let recreated = 0;
  let updated = 0;
  for (const b of (bookings ?? []) as Booking[]) {
    const ev = eventMap.get(b.event_id) as { name?: string; city?: string; event_date?: string } | undefined;
    const opts = {
      slotLabel: b.slot_id ? (slotMap.get(b.slot_id) as string | undefined) : undefined,
      location: ev?.city,
      eventName: ev?.name,
      eventDate: ev?.event_date,
    };
    const res = await pushBookingToWorkspaces(b, { fullUpdate: true, dev: opts, ambassador: opts });
    for (const ws of ["dev", "ambassador"] as const) {
      if (res[ws] === "created") recreated++;
      else if (res[ws] === "updated") updated++;
    }
  }
  return { bookings: (bookings ?? []).length, recreated, updated };
}
