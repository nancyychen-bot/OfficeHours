import type { Booking } from "../sync/types";

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
    booking.attend_reasons.toLowerCase().includes("1:1 help")
  );
}
