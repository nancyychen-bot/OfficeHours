import { getEventByLumaId } from "../db/events";
import { matchSlotForEvent } from "../db/slots";
import { upsertBookingFromLuma, checkInByLumaGuestId } from "../db/bookings";
import { pushBookingToWorkspaces } from "../notion/push";
import { sendBookingComms } from "../email/comms";
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
 * `sendCheckInComms` is true only for the live webhook; the backfill imports
 * silently so it never blasts retroactive emails.
 */
export async function ingestRegistration(
  norm: NormalizedRegistration,
  opts: { sendCheckInComms: boolean },
): Promise<IngestOutcome> {
  const event = await getEventByLumaId(norm.lumaEventId);
  if (!event) {
    return { status: "ignored", reason: `not a registered Notion Build Bar event (${norm.lumaEventId})` };
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
    lumaStatus: approvalStatusToLumaStatus(norm.approvalStatus),
  });

  let checkedIn = false;
  if (norm.isCheckedIn && booking.status !== "checked_in") {
    const updated = await checkInByLumaGuestId(norm.lumaGuestId);
    if (updated) {
      booking = updated;
      checkedIn = true;
      if (opts.sendCheckInComms) await sendBookingComms(updated.id, "checked_in");
    }
  }

  await pushBookingToWorkspaces(booking, {
    fullUpdate: true,
    dev: { slotLabel: slot?.name ?? null, location: event.city, eventName: event.name, eventDate: event.event_date },
    ambassador: { slotLabel: slot?.name ?? null, location: event.city, eventName: event.name, eventDate: event.event_date },
  });

  return { status: "ingested", booking, checkedIn };
}
