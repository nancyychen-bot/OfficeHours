import { listBookingsForEvent, setLumaStatus, resetAssignment } from "../db/bookings";
import { listEventsByDate, getEventById } from "../db/events";
import { sendBookingComms } from "../email/comms";
import { pushBookingToWorkspaces } from "../notion/push";
import { updateGuestStatus } from "../luma/client";
import { applyLumaStatus, type ApplyDeps } from "../sync/approval";
import { logSync } from "../sync/log";
import { isoDatePlusDays } from "./prep";
import type { Booking } from "../sync/types";

/**
 * All still-`pending` bookings are declinable the day before the event —
 * regardless of whether they requested a 1:1 (unassigned) or not (no_help_needed).
 * Approved / waitlist / already-declined are left untouched.
 */
export function selectDeclinablePendings(bookings: Booking[]): Booking[] {
  return bookings.filter((b) => b.luma_status === "pending");
}

/** applyLumaStatus deps for a cron-origin decline (same shape as the Notion route). */
function declineDeps(): ApplyDeps {
  return {
    setLumaStatus,
    resetAssignment,
    pushToWorkspaces: (b) => pushBookingToWorkspaces(b),
    updateGuestOnLuma: (eventLumaId, guestLumaId, next) =>
      updateGuestStatus({ eventLumaId, guestLumaId, status: next }),
    sendComms: (bid, kind) => sendBookingComms(bid, kind),
    getEventLumaId: async (eventId) => (await getEventById(eventId))?.luma_event_id ?? null,
    log: async (e) =>
      logSync({ direction: "luma_in", result: e.error ? "error" : "applied", action: e.action, note: e.note }),
  };
}

/** Decline every still-pending booking of one event. Best-effort per booking. */
export async function declinePendingForEvent(eventId: string): Promise<number> {
  const pendings = selectDeclinablePendings(await listBookingsForEvent(eventId));
  const deps = declineDeps();
  let declined = 0;
  for (const b of pendings) {
    try {
      await applyLumaStatus(b, "declined", { source: "cron" }, deps);
      declined++;
    } catch (err) {
      await logSync({
        direction: "luma_in",
        result: "error",
        bookingId: b.id,
        action: "decline_pending_error",
        note: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return declined;
}

/** For every event happening TOMORROW, decline all still-pending guests. */
export async function dispatchDeclinePendingForTomorrow(
  now: Date = new Date(),
): Promise<{ events: number; guests: number }> {
  const target = isoDatePlusDays(now, 1);
  const events = await listEventsByDate(target);
  let guests = 0;
  for (const ev of events) guests += await declinePendingForEvent(ev.id);
  return { events: events.length, guests };
}
