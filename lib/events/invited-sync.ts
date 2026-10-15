import type { LumaGuestListEntry } from "../luma/types";
import type { Booking } from "../sync/types";
import { approvalStatusToLumaStatus } from "../luma/approval";

/**
 * Which guest-list entries the invited-sync should ingest this tick:
 * - a currently-`invited` guest with no booking yet (a new host invite), or
 * - a booking still stored `invited` whose Luma status has since moved on (they
 *   accepted + registered).
 * Steady-state invited guests (stored invited, still invited) are skipped so the
 * cron doesn't re-upsert/re-push hundreds every run. Non-invited guests that the
 * live webhook already handles are ignored.
 */
export function selectInvitedToSync(
  guests: LumaGuestListEntry[],
  bookingsByGuestId: Map<string, Pick<Booking, "luma_status">>,
): LumaGuestListEntry[] {
  return guests.filter((entry) => {
    const current = approvalStatusToLumaStatus(entry.approval_status);
    const existing = bookingsByGuestId.get(entry.id);
    const isInvitedNow = current === "invited";
    const wasInvited = existing?.luma_status === "invited";
    if (!isInvitedNow && !wasInvited) return false; // not our concern
    if (!existing) return isInvitedNow; // brand-new invite
    return existing.luma_status !== current; // transitioned → re-ingest
  });
}
