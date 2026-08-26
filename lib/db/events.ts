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

/** Events whose local event_date falls in [fromYmd, toYmd] (inclusive), excluding
 * cancelled. Used by the timezone-aware cron dispatchers, which filter the result
 * per-event with isSendDue. */
export async function listEventsInDateRange(fromYmd: string, toYmd: string): Promise<EventRow[]> {
  const { data, error } = await getAdminClient()
    .from("events")
    .select("*")
    .gte("event_date", fromYmd)
    .lte("event_date", toYmd)
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
  publicUrl?: string | null;
  eventDate: string; // YYYY-MM-DD
  timezone: string;
  status?: Enums<"event_status">;
  lumaCalendar?: string; // keyring id of the owning Luma calendar
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
        // Tag the owning calendar (probed at ingest). Only when provided, so a
        // non-ingest upsert doesn't reset it.
        ...(input.lumaCalendar ? { luma_calendar: input.lumaCalendar } : {}),
        // Only overwrite public_url when we actually have one (don't clobber on re-register).
        ...(input.publicUrl ? { public_url: input.publicUrl } : {}),
        event_date: input.eventDate,
        timezone: input.timezone,
        // Only set status when explicitly provided — a plain re-register must NOT
        // resurrect a cancelled/completed event back to 'planned'. New rows get the
        // DB default ('planned', per migration 0001).
        ...(input.status ? { status: input.status } : {}),
      },
      { onConflict: "luma_event_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
