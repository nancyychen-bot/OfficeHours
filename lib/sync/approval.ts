import type { Booking, LumaStatus } from "./types";
import type { CommsKind } from "../email/templates";

export type ApprovalSource = "luma" | "dev" | "ambassador";

export interface ApplyDeps {
  setLumaStatus: (bookingId: string, next: LumaStatus) => Promise<Booking | null>;
  resetAssignment: (bookingId: string, to: "unassigned" | "no_help_needed") => Promise<Booking | null>;
  pushToWorkspaces: (booking: Booking) => Promise<unknown>;
  updateGuestOnLuma: (eventLumaId: string, guestLumaId: string, next: LumaStatus) => Promise<void>;
  sendComms: (bookingId: string, kind: CommsKind) => Promise<void>;
  getEventLumaId: (eventId: string) => Promise<string | null>;
  log: (entry: { action: string; note?: string; error?: boolean }) => Promise<void>;
}

/**
 * Apply an approval (luma_status) change from any inbound leg:
 * 1) persist the approval axis; 2) on a downgrade (waitlist/declined) of an
 * ASSIGNED booking, release helper+slot and email both parties; 3) for
 * Notion-originated changes only, write the decision back to Luma; 4) mirror the
 * resulting state to both Notion workspaces. Never throws (best-effort sync).
 */
export async function applyLumaStatus(
  booking: Booking,
  next: LumaStatus,
  opts: { source: ApprovalSource },
  deps: ApplyDeps,
): Promise<void> {
  const wasAssigned = booking.status === "assigned";
  let current = (await deps.setLumaStatus(booking.id, next)) ?? booking;

  const releaseTo = booking.requested_slot ? "unassigned" : "no_help_needed";
  // Downgrades notify the guest (assigned or not) and release the helper if the
  // booking was claimed. Email BEFORE clearing: resetAssignment nulls
  // booked_by_email, which the helper copy needs.
  if (next === "declined" || next === "waitlist") {
    await deps.sendComms(booking.id, next === "declined" ? "declined" : "waitlisted");
    if (wasAssigned) current = (await deps.resetAssignment(booking.id, releaseTo)) ?? current;
  }

  if (opts.source !== "luma") {
    try {
      const eventLumaId = await deps.getEventLumaId(booking.event_id);
      if (eventLumaId && booking.luma_guest_id) {
        await deps.updateGuestOnLuma(eventLumaId, booking.luma_guest_id, next);
      } else {
        await deps.log({ action: "luma_writeback_skipped", note: "missing event/guest luma id" });
      }
    } catch (err) {
      await deps.log({ action: "luma_writeback_error", note: err instanceof Error ? err.message : String(err), error: true });
    }
  }

  await deps.pushToWorkspaces(current);
}
