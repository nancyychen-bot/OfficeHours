import { listBookingsForEvent } from "../db/bookings";
import { listEventsByDate } from "../db/events";
import { sendBookingComms } from "../email/comms";
import { isoDatePlusDays } from "./prep";
import type { Booking } from "../sync/types";

/**
 * An APPROVED guest who requested a 1:1 but still has no expert the day before.
 * Only approved guests get any 1:1 email. Two sub-cases, by `previously_matched`:
 *  - true  → they had an expert who unclaimed → "your expert can't make it" (rematch_pending)
 *  - false → we never found them a match       → "couldn't match you" (unmatched_notice)
 */
export function isApprovedUnmatched(b: Booking): boolean {
  return (
    b.luma_status === "approved" &&
    !b.filtered &&
    !!b.requested_slot &&
    b.status === "unassigned" &&
    !!b.guest_email
  );
}

/** Send the correct day-before email to each unmatched 1:1 guest of one event. Idempotent. */
export async function sendRematchForEvent(eventId: string): Promise<number> {
  const eligible = (await listBookingsForEvent(eventId)).filter(isApprovedUnmatched);
  for (const b of eligible) {
    await sendBookingComms(b.id, b.previously_matched ? "rematch_pending" : "unmatched_notice");
  }
  return eligible.length;
}

/** For every event happening TOMORROW, email still-unmatched approved 1:1 guests. */
export async function dispatchRematchForTomorrow(now: Date = new Date()): Promise<{ events: number; guests: number }> {
  const target = isoDatePlusDays(now, 1);
  const events = await listEventsByDate(target);
  let guests = 0;
  for (const ev of events) guests += await sendRematchForEvent(ev.id);
  return { events: events.length, guests };
}
