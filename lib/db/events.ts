import { getAdminClient } from "../supabase/admin";
import type { EventRow } from "../sync/types";

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
