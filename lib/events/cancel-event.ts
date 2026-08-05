import { getEventByLumaId, setEventStatus } from "../db/events";
import { listBookingsForEvent, cancelBooking } from "../db/bookings";
import { pushBookingToWorkspaces } from "../notion/push";
import { sendBookingComms } from "../email/comms";
import { logSync } from "../sync/log";

export interface CancelEventResult {
  found: boolean;
  cancelled: number;
}

/**
 * Cancel a whole event (Luma `event.canceled`): email every active booking's
 * guest + helper, remove their calendar holds, mark each booking cancelled, and
 * mirror to Notion. Emails go out BEFORE the cancel (which clears booked_by_email).
 * Idempotent — already-cancelled bookings are skipped.
 */
export async function cancelEventByLumaId(lumaEventId: string): Promise<CancelEventResult> {
  const event = await getEventByLumaId(lumaEventId);
  if (!event) return { found: false, cancelled: 0 };

  const bookings = await listBookingsForEvent(event.id);
  let cancelled = 0;
  for (const b of bookings) {
    if (b.status === "cancelled") continue;
    try {
      await sendBookingComms(b.id, "event_cancelled");
      const done = await cancelBooking(b.id);
      if (done) {
        await pushBookingToWorkspaces(done);
        cancelled++;
      }
    } catch (err) {
      await logSync({
        direction: "luma_in",
        result: "error",
        bookingId: b.id,
        action: "event_cancel_booking",
        note: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await setEventStatus(event.id, "cancelled");
  return { found: true, cancelled };
}
