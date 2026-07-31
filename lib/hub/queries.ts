import { getAdminClient } from "@/lib/supabase/admin";

export interface HubBooking {
  id: string;
  guest_name: string;
  guest_email: string | null;
  company: string | null;
  challenge: string | null;
  status: string;
  booked_by_display_name: string | null;
  booked_by_type: string | null;
  location: string | null;
  event_name: string | null;
  event_date: string | null;
  luma_event_id: string;
  slot_name: string | null;
  slot_starts_at: string | null;
}

export interface HubEvent {
  id: string;
  name: string;
  city: string | null;
  event_date: string | null;
  luma_event_id: string;
  status: string;
  slot_count: number;
  booking_count: number;
}

export interface SyncSummary {
  lastSyncAt: string | null;
  trackedEvents: number;
}

/** All bookings with resolved event/slot context, newest event first. */
export async function listBookings(): Promise<HubBooking[]> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("booking_details")
    .select(
      "id,guest_name,guest_email,company,challenge,status,booked_by_display_name,booked_by_type,location,event_name,event_date,slot_name,slot_starts_at,events(luma_event_id)",
    )
    .order("event_date", { ascending: true })
    .order("slot_starts_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((b) => {
    // Supabase may type the joined `events` relation as an array; read the first.
    const rawEv = (b as { events?: unknown }).events;
    const ev = Array.isArray(rawEv) ? rawEv[0] : rawEv;
    const lumaEventId = (ev as { luma_event_id?: string } | null | undefined)?.luma_event_id;
    return {
      id: b.id as string,
      guest_name: b.guest_name as string,
      guest_email: (b.guest_email as string) ?? null,
      company: (b.company as string) ?? null,
      challenge: (b.challenge as string) ?? null,
      status: b.status as string,
      booked_by_display_name: (b.booked_by_display_name as string) ?? null,
      booked_by_type: (b.booked_by_type as string) ?? null,
      location: (b.location as string) ?? null,
      event_name: (b.event_name as string) ?? null,
      event_date: (b.event_date as string) ?? null,
      luma_event_id: (lumaEventId as string) ?? "",
      slot_name: (b.slot_name as string) ?? null,
      slot_starts_at: (b.slot_starts_at as string) ?? null,
    };
  });
}

/** All events with slot + (non-cancelled) booking counts. */
export async function listEvents(): Promise<HubEvent[]> {
  const supabase = getAdminClient();
  const { data: events, error } = await supabase
    .from("events")
    .select("id,name,city,event_date,luma_event_id,status")
    .order("event_date", { ascending: true });
  if (error) throw error;
  const { data: slots, error: sErr } = await supabase.from("slots").select("event_id");
  if (sErr) throw sErr;
  const { data: bookings, error: bErr } = await supabase
    .from("bookings")
    .select("event_id,status")
    .neq("status", "cancelled");
  if (bErr) throw bErr;

  const slotCount = new Map<string, number>();
  for (const s of slots ?? []) slotCount.set(s.event_id as string, (slotCount.get(s.event_id as string) ?? 0) + 1);
  const bookCount = new Map<string, number>();
  for (const b of bookings ?? []) bookCount.set(b.event_id as string, (bookCount.get(b.event_id as string) ?? 0) + 1);

  return (events ?? []).map((e) => ({
    id: e.id as string,
    name: e.name as string,
    city: (e.city as string) ?? null,
    event_date: (e.event_date as string) ?? null,
    luma_event_id: e.luma_event_id as string,
    status: e.status as string,
    slot_count: slotCount.get(e.id as string) ?? 0,
    booking_count: bookCount.get(e.id as string) ?? 0,
  }));
}

/** Last successful hub→Notion push time + count of non-cancelled events. */
export async function syncSummary(): Promise<SyncSummary> {
  const supabase = getAdminClient();
  const { data: last } = await supabase
    .from("sync_log")
    .select("created_at,direction,result")
    .in("direction", ["hub_to_dev", "hub_to_amb"])
    .eq("result", "applied")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { count } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .neq("status", "cancelled");
  return {
    lastSyncAt: (last?.created_at as string) ?? null,
    trackedEvents: count ?? 0,
  };
}
