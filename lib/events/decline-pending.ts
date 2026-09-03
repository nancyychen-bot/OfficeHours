import { listBookingsForEvent, setLumaStatus, resetAssignment } from "../db/bookings";
import { listEventsInDateRange, getEventById } from "../db/events";
import { sendBookingComms } from "../email/comms";
import { pushBookingToWorkspaces } from "../notion/push";
import { updateGuestStatus } from "../luma/client";
import { apiKeyForCalendar } from "../luma/calendars";
import { applyLumaStatus, type ApplyDeps } from "../sync/approval";
import { logSync } from "../sync/log";
import { isSendDue, scanWindow, DECLINE_HOUR } from "./schedule";
import type { Booking } from "../sync/types";

/**
 * All still-`pending` bookings are declinable the day before the event —
 * regardless of whether they requested a 1:1 (unassigned) or not (no_help_needed).
 * Approved / waitlist / already-declined are left untouched.
 */
export function selectDeclinablePendings(bookings: Booking[]): Booking[] {
  return bookings.filter((b) => b.luma_status === "pending");
}

/** applyLumaStatus deps for a cron-origin decline (same shape as the Notion route).
 * `apiKey` is the owning calendar's key, resolved once per event by the caller. */
function declineDeps(bookingId: string, apiKey: string): ApplyDeps {
  return {
    setLumaStatus,
    resetAssignment,
    pushToWorkspaces: (b) => pushBookingToWorkspaces(b),
    updateGuestOnLuma: (eventLumaId, guestLumaId, next) =>
      updateGuestStatus({ eventLumaId, guestLumaId, status: next, apiKey }),
    sendComms: (bid, kind) => sendBookingComms(bid, kind),
    getEventLumaId: async (eventId) => (await getEventById(eventId))?.luma_event_id ?? null,
    log: async (e) =>
      logSync({ direction: "luma_in", result: e.error ? "error" : "applied", bookingId, action: e.action, note: e.note }),
  };
}

/**
 * How many guests to decline in parallel. Each decline is ~7 sequential network
 * calls (status write → declined email → Luma write-back → Notion push ×2 workspaces),
 * so a strictly-sequential loop only cleared ~15–20 guests before the 60s function
 * budget killed it mid-run — stranding the rest as `pending`. A bounded pool lifts
 * throughput ~5× while staying gentle on the Luma/Notion/Resend rate limits. Kept
 * modest on purpose. See the route's `maxDuration` for the matching time budget.
 */
const DECLINE_CONCURRENCY = 5;

/** Decline every still-pending booking of one event. Best-effort per booking,
 * bounded-concurrency so a large pending list drains within the function budget. */
export async function declinePendingForEvent(eventId: string): Promise<number> {
  const pendings = selectDeclinablePendings(await listBookingsForEvent(eventId));
  // Resolve the owning calendar's key once — every pending shares this event.
  // Guard: an orphaned/renamed calendar tag must not throw and strand every
  // pending guest for this event; skip the event instead (same as luma-stats).
  let apiKey: string;
  try {
    apiKey = await apiKeyForCalendar((await getEventById(eventId))?.luma_calendar);
  } catch (err) {
    console.error(`[decline-pending] no calendar key for event ${eventId} — skipping`, err);
    return 0;
  }
  let declined = 0;
  let cursor = 0;

  // Shared-cursor worker pool: each worker pulls the next pending booking until
  // the list is drained. `declined++` is safe (single-threaded; only mutated
  // synchronously right after an await resolves).
  async function worker(): Promise<void> {
    while (cursor < pendings.length) {
      const b = pendings[cursor++];
      try {
        await applyLumaStatus(b, "declined", { source: "cron" }, declineDeps(b.id, apiKey));
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
  }

  const workers = Array.from({ length: Math.min(DECLINE_CONCURRENCY, pendings.length) }, worker);
  await Promise.all(workers);
  return declined;
}

/** Decline still-pending guests at 8am local, the day before each event (before
 * the 9am reminders, so declines are reflected). */
export async function dispatchDeclinePendingForTomorrow(
  now: Date = new Date(),
): Promise<{ events: number; guests: number }> {
  const { from, to } = scanWindow(now);
  const events = (await listEventsInDateRange(from, to)).filter((e) => isSendDue(now, e, { offsetDays: -1, targetHour: DECLINE_HOUR }));
  let guests = 0;
  for (const ev of events) guests += await declinePendingForEvent(ev.id);
  return { events: events.length, guests };
}
