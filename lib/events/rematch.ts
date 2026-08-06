import { listBookingsForEvent } from "../db/bookings";
import { listEventsByDate } from "../db/events";
import { sendBookingComms } from "../email/comms";
import { isoDatePlusDays } from "./prep";
import type { Booking } from "../sync/types";

/**
 * A guest who requested a 1:1 but still has no expert. Their expert may have
 * unclaimed (we suppress the immediate email and try to re-match in the
 * background); this is who gets the day-before apology if we couldn't refill.
 */
export function isUnmatchedOneOnOne(b: Booking): boolean {
  return (
    !!b.requested_slot &&
    b.status === "unassigned" &&
    b.luma_status !== "declined" &&
    b.luma_status !== "waitlist" &&
    !!b.guest_email
  );
}

/** Send the re-match apology to every unmatched 1:1 guest of one event. Idempotent. */
export async function sendRematchForEvent(eventId: string): Promise<number> {
  const eligible = (await listBookingsForEvent(eventId)).filter(isUnmatchedOneOnOne);
  for (const b of eligible) {
    await sendBookingComms(b.id, "rematch_pending");
  }
  return eligible.length;
}

/** For every event happening TOMORROW, apologize to still-unmatched 1:1 guests. */
export async function dispatchRematchForTomorrow(now: Date = new Date()): Promise<{ events: number; guests: number }> {
  const target = isoDatePlusDays(now, 1);
  const events = await listEventsByDate(target);
  let guests = 0;
  for (const ev of events) guests += await sendRematchForEvent(ev.id);
  return { events: events.length, guests };
}
