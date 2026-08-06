import { getEventByLumaId } from "../db/events";
import { matchSlotForEvent } from "../db/slots";
import { upsertBookingFromLuma, checkInByLumaGuestId, getBookingByLumaGuestId } from "../db/bookings";
import { pushBookingToWorkspaces } from "../notion/push";
import { sendBookingComms } from "../email/comms";
import { clearAllComms, clearCommsForKinds } from "../db/email-log";
import { approvalStatusToLumaStatus } from "../luma/approval";
import type { NormalizedRegistration } from "../luma/parse";
import type { Booking } from "../sync/types";

export type IngestOutcome =
  | { status: "ignored"; reason: string }
  | { status: "ingested"; booking: Booking; checkedIn: boolean };

/**
 * Create/update a booking from a normalized Luma registration and mirror it to
 * both Notion workspaces. Shared by the Luma webhook (live) and the event
 * backfill (bulk import from guests/list).
 *
 * `live` is true only for the live webhook; the backfill imports silently so it
 * never blasts retroactive emails.
 */
export async function ingestRegistration(
  norm: NormalizedRegistration,
  opts: { live: boolean },
): Promise<IngestOutcome> {
  const event = await getEventByLumaId(norm.lumaEventId);
  if (!event) {
    return { status: "ignored", reason: `not a registered Notion Build Bar event (${norm.lumaEventId})` };
  }

  const nextLumaStatus = approvalStatusToLumaStatus(norm.approvalStatus);
  const prior = await getBookingByLumaGuestId(norm.lumaGuestId);

  // Approval change made in Luma (a guest self-cancel, or an organizer acting in
  // Luma instead of Notion): send the same downgrade emails as the Notion path,
  // BEFORE the upsert releases the helper (which clears booked_by_email). Gated on
  // an actual transition so it never duplicates the Notion path's echo. Live only.
  if (opts.live && prior && prior.luma_status !== nextLumaStatus) {
    if (nextLumaStatus === "declined") await sendBookingComms(prior.id, "declined");
    else if (nextLumaStatus === "waitlist") await sendBookingComms(prior.id, "waitlisted");
  }

  const slot = norm.requestedSlot
    ? await matchSlotForEvent({ eventId: event.id, requestedLabel: norm.requestedSlot })
    : null;

  let booking = await upsertBookingFromLuma({
    lumaGuestId: norm.lumaGuestId,
    eventId: event.id,
    slotId: slot?.id ?? null,
    guestName: norm.guestName,
    guestEmail: norm.guestEmail,
    guestPhone: norm.guestPhone,
    role: norm.role,
    company: norm.company,
    challenge: norm.challenge,
    notionEmail: norm.notionEmail,
    notionPlan: norm.notionPlan,
    experienceLevel: norm.experienceLevel,
    attendReasons: norm.attendReasons,
    requestedSlot: norm.requestedSlot,
    lumaStatus: nextLumaStatus,
  });

  // Reactivation (a cancelled booking re-registering) is a fresh episode — clear
  // its stale send records so the next round of comms (invite on claim, another
  // decline/waitlist notice, etc.) isn't suppressed by the per-booking dedup.
  if (prior?.status === "cancelled" && booking.status !== "cancelled") {
    await clearAllComms(booking.id);
  }

  // Slot/time changed on an already-assigned booking (guest edited their 1:1 time
  // in Luma) → re-issue the calendar invite with the new time. Clear the prior
  // 'assigned' send so it isn't deduped; the monotonic ICS SEQUENCE updates the
  // existing event on attendees' calendars.
  if (opts.live && prior?.status === "assigned" && prior.slot_id !== (slot?.id ?? null)) {
    await clearCommsForKinds(booking.id, ["assigned"]);
    await sendBookingComms(booking.id, "assigned");
  }

  let checkedIn = false;
  if (norm.isCheckedIn && booking.status !== "checked_in") {
    // If the no-show cron already fired, this is a late arrival — tell the expert
    // the guest is actually here (a distinct message from the normal check-in).
    const wasNoShow = booking.status === "no_show";
    const updated = await checkInByLumaGuestId(norm.lumaGuestId);
    if (updated) {
      booking = updated;
      checkedIn = true;
      if (opts.live) await sendBookingComms(updated.id, wasNoShow ? "arrived_after_no_show" : "checked_in");
    }
  }

  await pushBookingToWorkspaces(booking, {
    fullUpdate: true,
    dev: { slotLabel: slot?.name ?? null, location: event.city, eventName: event.name, eventDate: event.event_date },
    ambassador: { slotLabel: slot?.name ?? null, location: event.city, eventName: event.name, eventDate: event.event_date },
  });

  return { status: "ingested", booking, checkedIn };
}
