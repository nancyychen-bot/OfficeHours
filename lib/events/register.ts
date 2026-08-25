import { getLumaEvent, extractSlotOptions, resolveLumaEventId } from "../luma/client";
import { generateSlotsFromOptions } from "./slots-gen";
import { reconcileSlots } from "./reconcile";
import { backfillEventGuests } from "./backfill";
import { upsertEvent } from "../db/events";
import { getAdminClient } from "../supabase/admin";
import { localCalendarDate } from "./event-date";

export interface RegisterInput {
  lumaEvent: string; // evt- id or URL containing one
  city?: string; // optional override; defaults to the Luma event's city
  slotStart?: string; // ISO instant for first slot; defaults to event start_at
  slotLengthMinutes?: number; // default 30
  publicUrl?: string; // explicit public URL override
}

/** If the value looks like a public event URL, normalize it; else null. */
function publicUrlFrom(input: string): string | null {
  const s = input.trim();
  return /^https?:\/\//i.test(s) ? s : null;
}

export interface RegisterResult {
  eventId: string;
  eventName: string;
  city: string;
  inserted: number;
  updated: number;
  deleted: number;
  skippedDeletes: number; // slots that would be removed but have bookings
  importedGuests: number; // existing Luma guests pulled in via backfill
}

/** The event's IANA timezone, or throw. Guards the Luma ingest path so a missing
 * timezone surfaces at registration rather than corrupting downstream local-date
 * calcs for an international event. (Non-ingest inserts still fall back to the
 * events.timezone DB default of 'America/Los_Angeles'.) */
export function requireTimezone(tz: string | null | undefined, eventId: string): string {
  const t = (tz ?? "").trim();
  if (!t) {
    throw new Error(
      `No timezone for ${eventId}: Luma didn't return an event timezone — set it in Luma and retry.`,
    );
  }
  return t;
}

/**
 * Register a Notion Build Bar event from Luma: upsert the event, then generate its
 * slots from the Luma slot dropdown (labels verbatim, times from start+length).
 * Idempotent — safe to re-run when the form changes.
 */
export async function registerEventFromLuma(input: RegisterInput): Promise<RegisterResult> {
  const supabase = getAdminClient();
  const eventId = await resolveLumaEventId(input.lumaEvent);
  const detail = await getLumaEvent(eventId);

  const timezone = requireTimezone(detail.timezone, detail.id);
  const eventDate = localCalendarDate(detail.start_at, timezone);

  // Prefer the city from the Luma event's address (source of truth, no typos);
  // allow an explicit override for edge cases where Luma's address is off.
  const city = input.city ?? detail.geo_address_json?.city;
  if (!city) {
    throw new Error(
      `No city for ${detail.id}: Luma event has no address city — pass --city explicitly.`,
    );
  }

  // Public URL: an explicit override, else the URL they registered with (the
  // add-event form / script usually gets the lu.ma link), else whatever Luma returns.
  const publicUrl =
    input.publicUrl ??
    publicUrlFrom(input.lumaEvent) ??
    ((detail as { url?: string }).url ?? null);

  const event = await upsertEvent({
    lumaEventId: detail.id,
    name: detail.name,
    city,
    // Specific street address for calendar invites (falls back to city if absent).
    address: detail.geo_address_json?.full_address ?? null,
    publicUrl,
    eventDate,
    timezone,
    // Status intentionally omitted: a new event gets the DB default ('planned'),
    // and re-registering an existing event must not reset its status.
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

  // Backfill any guests who registered before the event was tracked (Luma
  // doesn't resend webhooks). Best-effort: never fail the registration over it.
  let importedGuests = 0;
  try {
    const backfill = await backfillEventGuests(detail.id);
    importedGuests = backfill.imported;
  } catch (err) {
    console.error("[register] guest backfill failed", err);
  }

  return {
    eventId: event.id,
    eventName: event.name,
    city,
    inserted: plan.toInsert.length,
    updated: plan.toUpdate.length,
    deleted: deletable.length,
    skippedDeletes,
    importedGuests,
  };
}
