import type { Booking, LumaStatus } from "../sync/types";

/**
 * A Luma-origin decline is a guest self-cancellation (the team triages in Notion,
 * so Luma-side declines come from the guest going "Not Going"). Notify the expert
 * only when the 1:1 was actually claimed; the guest gets nothing (they cancelled
 * it themselves and Luma already confirms it).
 */
export function shouldSendGuestCancelled(prior: Booking, nextLumaStatus: LumaStatus): boolean {
  return nextLumaStatus === "declined" && !!prior.booked_by_email;
}
