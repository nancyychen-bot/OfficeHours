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

export async function setEventStatus(
  eventId: string,
  status: Enums<"event_status">,
): Promise<void> {
  const supabase = getAdminClient();
  const { error } = await supabase.from("events").update({ status }).eq("id", eventId);
  if (error) throw error;
}

/** Events happening on a specific calendar date (YYYY-MM-DD). Used by the T-3 prep cron. */
export async function listEventsByDate(dateISO: string): Promise<EventRow[]> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("event_date", dateISO)
    .neq("status", "cancelled");
  if (error) throw error;
  return data ?? [];
}

/** Events not yet feedback-dispatched (feedback_sent_at null, not cancelled). */
export async function listEventsPendingFeedback(): Promise<EventRow[]> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .is("feedback_sent_at", null)
    .neq("status", "cancelled");
  if (error) throw error;
  return data ?? [];
}

/** Mark an event's post-event feedback as dispatched so it never re-sends. */
export async function markFeedbackSent(eventId: string, at: string): Promise<void> {
  const supabase = getAdminClient();
  const { error } = await supabase.from("events").update({ feedback_sent_at: at }).eq("id", eventId);
  if (error) throw error;
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
  address?: string | null;
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
        address: input.address ?? null,
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
