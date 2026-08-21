import type { Booking } from "../sync/types";
import { listBookingsForEvent } from "../db/bookings";
import { sendBookingComms, sendCommsToEmail } from "../email/comms";

/**
 * A guest who asked for "1:1 help" in their reasons but booked no time slot
 * (so `status = no_help_needed`, no 1:1 possible). When such a guest is approved
 * they're coworking only — this predicate gates the clarification email.
 * Independent of `luma_status`; the caller fires it on the transition to approved.
 */
export function isCoworkOnlyMismatch(booking: Booking): boolean {
  return (
    booking.status === "no_help_needed" &&
    !!booking.attend_reasons &&
    // Matches the Luma reasons option "I need 1:1 help"; update if that label is reworded.
    booking.attend_reasons.toLowerCase().includes("1:1 help")
  );
}

/** Approved, no-slot "1:1 help" guests of an event (the backfill audience). */
export function selectCoworkOnlyBackfill(bookings: Booking[]): Booking[] {
  return bookings.filter((b) => b.luma_status === "approved" && isCoworkOnlyMismatch(b));
}

/** Send the cowork-only notice to every qualifying approved guest of one event. Idempotent. */
export async function sendCoworkNoticeForEvent(eventId: string): Promise<number> {
  const eligible = selectCoworkOnlyBackfill(await listBookingsForEvent(eventId));
  for (const b of eligible) await sendBookingComms(b.id, "cowork_only");
  return eligible.length;
}

/**
 * Send ONE real rendered cowork_only email to `testEmail` using a representative
 * qualifying booking of the event — for eyeballing before a real backfill.
 * email_log is keyed on the recipient address, so this writes no row for any real
 * guest and never blocks the later real send. Returns the sample booking id, or
 * null if the event has no qualifying guest.
 */
export async function sendCoworkNoticeTest(eventId: string, testEmail: string): Promise<string | null> {
  const [sample] = selectCoworkOnlyBackfill(await listBookingsForEvent(eventId));
  if (!sample) return null;
  await sendCommsToEmail(sample.id, "cowork_only", "guest", testEmail);
  return sample.id;
}
