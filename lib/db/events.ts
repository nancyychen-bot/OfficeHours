import { getAdminClient } from "../supabase/admin";
import type { EventRow } from "../sync/types";
import type { Enums } from "../supabase/types";

/**
 * Resolve an event from a Luma event id — the join key that lets a webhook
 * route to the right city/month without any manual mapping (PRD §11).
 */
export async function getEventByLumaId(lumaEventId: string): Promise<EventRow | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("luma_event_id", lumaEventId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getEventById(id: string): Promise<EventRow | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listEvents(): Promise<EventRow[]> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .order("event_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function upsertEvent(input: {
  lumaEventId: string;
  name: string;
  city: string;
  eventDate: string; // YYYY-MM-DD
  timezone: string;
  status?: Enums<"event_status">;
}): Promise<EventRow> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("events")
    .upsert(
      {
        luma_event_id: input.lumaEventId,
        name: input.name,
        city: input.city,
        event_date: input.eventDate,
        timezone: input.timezone,
        status: input.status ?? "planned",
      },
      { onConflict: "luma_event_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
