import type { Tables, Enums } from "../supabase/types";

export type Booking = Tables<"bookings">;
export type BookingDetails = Tables<"booking_details">;
export type EventRow = Tables<"events">;
export type SlotRow = Tables<"slots">;

export type BookingStatus = Enums<"booking_status">;
export type BookedByType = Enums<"booked_by_type">;
export type SyncDirection = Enums<"sync_direction">;

/**
 * The subset of a booking that actually crosses the sync boundary and can be
 * changed by a human inside a Notion workspace (PRD §6.3 / §8). Loop prevention
 * (PRD §7.3) is defined over exactly these fields: if an inbound webhook's
 * synced fields hash to the same value the hub last wrote, it's an echo.
 */
export interface SyncedFields {
  status: BookingStatus;
  booked_by_display_name: string | null;
  booked_by_type: BookedByType | null;
}

export function pickSyncedFields(b: Pick<Booking, keyof SyncedFields>): SyncedFields {
  return {
    status: b.status,
    booked_by_display_name: b.booked_by_display_name,
    booked_by_type: b.booked_by_type,
  };
}
