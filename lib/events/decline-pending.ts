import type { Booking } from "../sync/types";

/**
 * All still-`pending` bookings are declinable the day before the event —
 * regardless of whether they requested a 1:1 (unassigned) or not (no_help_needed).
 * Approved / waitlist / already-declined are left untouched.
 */
export function selectDeclinablePendings(bookings: Booking[]): Booking[] {
  return bookings.filter((b) => b.luma_status === "pending");
}
