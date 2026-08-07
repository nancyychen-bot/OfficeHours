import { getAdminClient } from "../supabase/admin";
import { getBookingById, setBookingSlot, releaseBooking } from "../db/bookings";
import { getEventById } from "../db/events";
import { clearCommsForKinds } from "../db/email-log";
import { sendBookingComms } from "../email/comms";
import { pushBookingToWorkspaces } from "../notion/push";
import { postSlackRecruit } from "../slack/client";

export interface ChangeableSlot { id: string; name: string }
export interface ChangeableBooking {
  bookingId: string;
  eventName: string | null;
  city: string | null;
  eventDate: string | null;
  currentSlotId: string | null;
  currentSlotName: string | null;
  slots: ChangeableSlot[];
}

function emailMatches(row: { guest_email?: string | null; notion_email?: string | null }, email: string): boolean {
  const e = email.trim().toLowerCase();
  return (row.guest_email ?? "").trim().toLowerCase() === e || (row.notion_email ?? "").trim().toLowerCase() === e;
}

/** Upcoming 1:1 bookings for this email that can still be re-slotted. */
export async function findChangeableBookings(email: string, now: Date = new Date()): Promise<ChangeableBooking[]> {
  const e = email.trim().toLowerCase();
  if (!e) return [];
  const today = now.toISOString().slice(0, 10);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getAdminClient() as any;
  const { data } = await supabase
    .from("booking_details")
    .select("id, event_id, event_name, location, event_date, slot_id, slot_name, requested_slot, status, guest_email, notion_email")
    .gte("event_date", today);

  const rows = (data ?? []).filter(
    (r: Record<string, unknown>) =>
      emailMatches(r as { guest_email?: string; notion_email?: string }, e) &&
      !!r.requested_slot && // they wanted a 1:1
      r.status !== "cancelled",
  );

  const out: ChangeableBooking[] = [];
  for (const r of rows) {
    const { data: slots } = await supabase.from("slots").select("id, name, starts_at").eq("event_id", r.event_id).order("starts_at");
    out.push({
      bookingId: r.id,
      eventName: r.event_name ?? null,
      city: r.location ?? null,
      eventDate: r.event_date ?? null,
      currentSlotId: r.slot_id ?? null,
      currentSlotName: r.slot_name ?? null,
      slots: (slots ?? []).map((s: Record<string, unknown>) => ({ id: s.id as string, name: s.name as string })),
    });
  }
  return out;
}

export interface ChangeResult { ok: boolean; error?: string; slotName?: string; eventName?: string | null }

/**
 * Self-serve slot change. Verifies the booking belongs to `email`, re-binds the
 * slot, releases the expert (unassigned, stays Approved on Luma), notifies both
 * parties (guest: new time + rematch coming; expert: removed + calendar cancel),
 * mirrors to both cards, and re-opens for matching (Slack recruit).
 */
export async function changeSlot(bookingId: string, email: string, newSlotId: string): Promise<ChangeResult> {
  const booking = await getBookingById(bookingId);
  if (!booking) return { ok: false, error: "Booking not found." };
  if (!emailMatches(booking, email)) return { ok: false, error: "That email doesn't match this booking." };
  if (newSlotId === booking.slot_id) return { ok: false, error: "That's already your current slot." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getAdminClient() as any;
  const { data: slot } = await supabase.from("slots").select("id, name, event_id").eq("id", newSlotId).maybeSingle();
  if (!slot || slot.event_id !== booking.event_id) return { ok: false, error: "That time slot isn't part of this event." };

  // Re-bind slot, then notify BOTH (expert email needs booked_by_email, so send
  // before releasing), then release + re-open.
  await setBookingSlot(bookingId, newSlotId);
  await sendBookingComms(bookingId, "slot_changed"); // guest (new time) + expert (removed + CANCEL)
  await releaseBooking(bookingId); // → unassigned, clears booked_by; luma_status (Approved) untouched
  await clearCommsForKinds(bookingId, ["assigned"]); // so a fresh claim re-sends the invite

  const updated = (await getBookingById(bookingId)) ?? booking;
  const ev = await getEventById(updated.event_id);
  const opts = { slotLabel: slot.name as string, location: ev?.city, eventName: ev?.name, eventDate: ev?.event_date };
  await pushBookingToWorkspaces(updated, { fullUpdate: true, dev: opts, ambassador: opts, clearPersonOn: ["dev", "ambassador"] });
  await postSlackRecruit(bookingId); // recruit an expert for the new time

  return { ok: true, slotName: slot.name as string, eventName: ev?.name ?? null };
}
