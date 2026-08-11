import { listBookingsForEvent } from "../db/bookings";
import { listEventsByDate } from "../db/events";
import { sendBookingComms } from "../email/comms";
import type { Booking } from "../sync/types";

/** How many days before an event the prep email goes out. */
export const PREP_LEAD_DAYS = 3;

/**
 * A booking that should get the pre-event prep email: an APPROVED guest with an
 * email whose booking isn't cancelled. The email says "you're confirmed", so only
 * Approved guests qualify (pending/waitlisted/declined are excluded).
 */
export function isEligibleForPrep(b: Booking): boolean {
  return b.luma_status === "approved" && !b.filtered && !!b.guest_email && b.status !== "cancelled";
}

/** Send the prep email to every eligible guest of one event. Idempotent (email_log dedup). */
export async function sendPrepForEvent(eventId: string): Promise<number> {
  const bookings = await listBookingsForEvent(eventId);
  const eligible = bookings.filter(isEligibleForPrep);
  for (const b of eligible) {
    await sendBookingComms(b.id, "prep_reminder");
  }
  return eligible.length;
}

/** ISO date "YYYY-MM-DD" that is `n` days from `from` (UTC). */
export function isoDatePlusDays(from: Date, n: number): string {
  return new Date(from.getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

/** Send prep emails for every event happening exactly PREP_LEAD_DAYS from `now`. */
export async function sendPrepForLeadWindow(now: Date = new Date()): Promise<{ events: number; guests: number }> {
  const targetDate = isoDatePlusDays(now, PREP_LEAD_DAYS);
  const events = await listEventsByDate(targetDate);
  let guests = 0;
  for (const ev of events) {
    guests += await sendPrepForEvent(ev.id);
  }
  return { events: events.length, guests };
}
