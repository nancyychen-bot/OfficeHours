import { getLumaEvent, extractSlotOptions, parseLumaEventId } from "../luma/client";
import { generateSlotsFromOptions } from "./slots-gen";
import { reconcileSlots } from "./reconcile";
import { upsertEvent } from "../db/events";
import { getAdminClient } from "../supabase/admin";
import { localCalendarDate } from "./event-date";

export interface RegisterInput {
  lumaEvent: string; // evt- id or URL containing one
  city: string;
  slotStart?: string; // ISO instant for first slot; defaults to event start_at
  slotLengthMinutes?: number; // default 30
}

export interface RegisterResult {
  eventId: string;
  eventName: string;
  inserted: number;
  updated: number;
  deleted: number;
  skippedDeletes: number; // slots that would be removed but have bookings
}

/**
 * Register an Office Hours event from Luma: upsert the event, then generate its
 * slots from the Luma slot dropdown (labels verbatim, times from start+length).
 * Idempotent — safe to re-run when the form changes.
 */
export async function registerEventFromLuma(input: RegisterInput): Promise<RegisterResult> {
  const supabase = getAdminClient();
  const eventId = parseLumaEventId(input.lumaEvent);
  const detail = await getLumaEvent(eventId);

  const timezone = detail.timezone ?? "America/Los_Angeles";
  const eventDate = localCalendarDate(detail.start_at, timezone);

  const event = await upsertEvent({
    lumaEventId: detail.id,
    name: detail.name,
    city: input.city,
    eventDate,
    timezone,
    status: "planned",
  });

  const labels = extractSlotOptions(detail.registration_questions ?? []);
  const startAt = input.slotStart ?? detail.start_at;
  const desired = generateSlotsFromOptions(labels, startAt, input.slotLengthMinutes ?? 30);

  const { data: existing, error: exErr } = await supabase
    .from("slots")
    .select("id, name")
    .eq("event_id", event.id);
  if (exErr) throw exErr;

  const { data: booked, error: bErr } = await supabase
    .from("bookings")
    .select("slot_id")
    .eq("event_id", event.id)
    .not("slot_id", "is", null);
  if (bErr) throw bErr;
  const bookedSlotIds = new Set((booked ?? []).map((b) => b.slot_id));

  const plan = reconcileSlots(existing ?? [], desired);

  if (plan.toInsert.length) {
    const { error } = await supabase
      .from("slots")
      .insert(plan.toInsert.map((s) => ({ event_id: event.id, ...s })));
    if (error) throw error;
  }
  for (const u of plan.toUpdate) {
    const { error } = await supabase
      .from("slots")
      .update({ starts_at: u.starts_at, ends_at: u.ends_at })
      .eq("id", u.id);
    if (error) throw error;
  }
  const deletable = plan.toDeleteIds.filter((id) => !bookedSlotIds.has(id));
  const skippedDeletes = plan.toDeleteIds.length - deletable.length;
  if (deletable.length) {
    const { error } = await supabase.from("slots").delete().in("id", deletable);
    if (error) throw error;
  }

  return {
    eventId: event.id,
    eventName: event.name,
    inserted: plan.toInsert.length,
    updated: plan.toUpdate.length,
    deleted: deletable.length,
    skippedDeletes,
  };
}
