import type { Booking, BookedByType } from "../sync/types";
import { setBookingAssignment } from "../db/bookings";
import { sendBookingComms } from "../email/comms";
import { postClaimConfirmDM } from "../slack/notify";
import { pushBookingToWorkspaces } from "../notion/push";
import { logSync } from "../sync/log";

export interface AssignExpertInput {
  bookingId: string;
  displayName: string;
  email: string;
  type: BookedByType;
}

/** Pure: validate an assignment. Returns an error message, or null if OK. The email
 * is required because the assigned expert gets a calendar invite by email. */
export function validateAssignInput(i: AssignExpertInput): string | null {
  if (!i.displayName.trim()) return "Expert name is required.";
  const email = i.email.trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return "A valid expert email is required (for the calendar invite).";
  }
  if (i.type !== "employee" && i.type !== "ambassador") {
    return "Expert type must be employee or ambassador.";
  }
  return null;
}

/** Seams so the assign flow is testable without a live DB / Slack / Notion. */
export interface AssignDeps {
  setAssignment: (input: AssignExpertInput) => Promise<Booking | null>;
  invite: (bookingId: string) => Promise<void>;
  dm: (bookingId: string) => Promise<void>;
  mirror: (booking: Booking) => Promise<void>;
  log: (bookingId: string, note: string) => Promise<void>;
}

const defaultDeps: AssignDeps = {
  setAssignment: (input) =>
    setBookingAssignment(input.bookingId, {
      displayName: input.displayName.trim(),
      type: input.type,
      email: input.email.trim(),
    }),
  invite: (bookingId) => sendBookingComms(bookingId, "assigned"),
  dm: (bookingId) => postClaimConfirmDM(bookingId),
  // No native "Booked by" Person to set cross-workspace; clear any stale chip on
  // both cards and let the "Booked by (name)" text mirror carry the name.
  mirror: async (booking) => {
    await pushBookingToWorkspaces(booking, { clearPersonOn: ["dev", "ambassador"] });
  },
  log: (bookingId, note) =>
    logSync({ direction: "luma_in", result: "applied", bookingId, action: "hub_assign", note }),
};

/**
 * Assign a specific expert to a booking from the hub (organizer-driven, live during
 * an event). Works from ANY prior status — fills an unassigned 1:1, converts a
 * cowork/no-help attendee who now wants one, or reassigns. Sends the expert the
 * calendar invite + a Slack claim-confirm DM and mirrors both Notion cards.
 */
export async function assignExpert(
  input: AssignExpertInput,
  deps: AssignDeps = defaultDeps,
): Promise<{ ok: boolean; error?: string }> {
  const err = validateAssignInput(input);
  if (err) return { ok: false, error: err };

  const booking = await deps.setAssignment(input);
  if (!booking) return { ok: false, error: "Booking not found." };

  await deps.invite(input.bookingId);
  try {
    await deps.dm(input.bookingId); // Slack DM is best-effort; never fail the assign over it
  } catch {
    /* ignore */
  }
  await deps.mirror(booking);
  await deps.log(input.bookingId, `${input.displayName.trim()} <${input.email.trim()}> (${input.type})`);
  return { ok: true };
}
