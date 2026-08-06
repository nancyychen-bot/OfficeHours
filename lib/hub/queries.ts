import { getAdminClient } from "@/lib/supabase/admin";

export interface HubBooking {
  id: string;
  guest_name: string;
  guest_email: string | null;
  company: string | null;
  challenge: string | null;
  status: string;
  luma_status: string | null;
  booked_by_display_name: string | null;
  booked_by_type: string | null;
  booked_by_email: string | null;
  location: string | null;
  event_name: string | null;
  event_date: string | null;
  luma_event_id: string;
  slot_name: string | null;
  slot_starts_at: string | null;
  requested_slot: string | null;
  role: string | null;
  guest_phone: string | null;
  notion_email: string | null;
  notion_plan: string | null;
  experience_level: string | null;
  attend_reasons: string | null;
}

export interface HubFeedback {
  id: string;
  guest_name: string | null;
  guest_email: string | null;
  satisfaction_label: string | null;
  satisfaction_score: number | null;
  confidence: string | null;
  interests: string[];
  feature_intent: string | null;
  highlight: string | null;
  notion_expert: string | null;
  needs_review: boolean;
  submitted_at: string | null;
  luma_event_id: string | null;
  event_name: string | null;
  event_date: string | null;
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
      "id,guest_name,guest_email,company,challenge,status,luma_status,booked_by_display_name,booked_by_type,booked_by_email,location,event_name,event_date,slot_name,slot_starts_at,requested_slot,role,guest_phone,notion_email,notion_plan,experience_level,attend_reasons,events(luma_event_id)",
    )
    .order("event_date", { ascending: true })
    .order("slot_starts_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((b) => {
    // Supabase may type the joined `events` relation as an array; read the first.
    const rawEv = (b as { events?: unknown }).events;
    const ev = Array.isArray(rawEv) ? rawEv[0] : rawEv;
    const lumaEventId = (ev as { luma_event_id?: string } | null | undefined)?.luma_event_id;
    const s = (k: string) => ((b as Record<string, unknown>)[k] as string) ?? null;
    return {
      id: b.id as string,
      guest_name: b.guest_name as string,
      guest_email: s("guest_email"),
      company: s("company"),
      challenge: s("challenge"),
      status: b.status as string,
      luma_status: s("luma_status"),
      booked_by_display_name: s("booked_by_display_name"),
      booked_by_type: s("booked_by_type"),
      booked_by_email: s("booked_by_email"),
      location: s("location"),
      event_name: s("event_name"),
      event_date: s("event_date"),
      luma_event_id: (lumaEventId as string) ?? "",
      slot_name: s("slot_name"),
      slot_starts_at: s("slot_starts_at"),
      requested_slot: s("requested_slot"),
      role: s("role"),
      guest_phone: s("guest_phone"),
      notion_email: s("notion_email"),
      notion_plan: s("notion_plan"),
      experience_level: s("experience_level"),
      attend_reasons: s("attend_reasons"),
    };
  });
}

/** All feedback responses (from feedback_mirror), newest first, with event labels. */
export async function listFeedback(): Promise<HubFeedback[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getAdminClient() as any;
  const { data, error } = await supabase
    .from("feedback_mirror")
    .select(
      "ambassador_page_id,guest_name,guest_email,satisfaction_label,satisfaction_score,confidence,interests,feature_intent,highlight,notion_expert,needs_review,submitted_at,matched_event_id",
    )
    .order("submitted_at", { ascending: false });
  if (error) throw error;

  const { data: events } = await supabase.from("events").select("id,name,event_date,luma_event_id");
  const evById = new Map<string, { name: string; event_date: string; luma_event_id: string }>();
  for (const e of events ?? []) evById.set(e.id, e);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => {
    const ev = r.matched_event_id ? evById.get(r.matched_event_id) : undefined;
    return {
      id: r.ambassador_page_id as string,
      guest_name: r.guest_name ?? null,
      guest_email: r.guest_email ?? null,
      satisfaction_label: r.satisfaction_label ?? null,
      satisfaction_score: r.satisfaction_score ?? null,
      confidence: r.confidence ?? null,
      interests: (r.interests as string[]) ?? [],
      feature_intent: r.feature_intent ?? null,
      highlight: r.highlight ?? null,
      notion_expert: r.notion_expert ?? null,
      needs_review: !!r.needs_review,
      submitted_at: r.submitted_at ?? null,
      luma_event_id: ev?.luma_event_id ?? null,
      event_name: ev?.name ?? null,
      event_date: ev?.event_date ?? null,
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
