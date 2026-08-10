import { getBookingById, getBookingDetailsById } from "../db/bookings";
import { toCommsFields } from "../email/comms";
import { fetchCardUrl } from "./client";
import { dmByEmail } from "./api";
import { buildClaimConfirmBlocks } from "./blocks";
import { logSync } from "../sync/log";

/**
 * DM the expert a claim/assignment confirmation (best-effort; additive to the
 * `assigned` email). Prefers the card link matching where the booking is claimed:
 * ambassador card for an ambassador, dev card otherwise.
 */
export async function postClaimConfirmDM(bookingId: string): Promise<void> {
  try {
    const booking = await getBookingById(bookingId);
    if (!booking?.booked_by_email) return;
    const details = await getBookingDetailsById(bookingId);
    if (!details) return;
    const f = toCommsFields(details);
    const isAmbassador = booking.booked_by_type === "ambassador";
    const cardUrl = isAmbassador
      ? await fetchCardUrl("ambassador", booking.notion_ambassador_page_id)
      : await fetchCardUrl("dev", booking.notion_dev_page_id);
    const blocks = buildClaimConfirmBlocks({
      guestName: f.guestName,
      slotName: f.slotName,
      eventName: f.eventName,
      eventDate: f.eventDate,
      cardUrl,
    });
    await dmByEmail(booking.booked_by_email, blocks, `You're confirmed to help ${f.guestName}`);
    await logSync({ direction: "luma_in", result: "applied", bookingId, action: "claim_confirm_dm" });
  } catch (err) {
    await logSync({ direction: "luma_in", result: "error", bookingId, action: "claim_confirm_dm", note: err instanceof Error ? err.message : String(err) });
  }
}
