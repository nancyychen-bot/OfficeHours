import type { LumaGuestListEntry, LumaGuestData } from "../luma/types";
import type { Booking } from "../sync/types";
import { approvalStatusToLumaStatus } from "../luma/approval";
import { normalizeGuest } from "../luma/parse";
import { ingestRegistration } from "./ingest";
import { listBookingsForEvent } from "../db/bookings";
import { logSync } from "../sync/log";

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

/**
 * Ingest the event's host-invited guests from an already-fetched guest list,
 * silently (no emails) and mirrored to both Notion DBs by ingestRegistration.
 * Idempotent via selectInvitedToSync; best-effort per guest.
 */
export async function syncInvitedGuestsForEvent(
  eventId: string,
  lumaEventId: string,
  guests: LumaGuestListEntry[],
): Promise<{ synced: number; failed: number }> {
  const bookings = await listBookingsForEvent(eventId);
  const byGuestId = new Map<string, Pick<Booking, "luma_status">>(
    bookings
      .filter((b) => b.luma_guest_id)
      .map((b) => [b.luma_guest_id as string, { luma_status: b.luma_status }]),
  );
  const toSync = selectInvitedToSync(guests, byGuestId);
  let synced = 0;
  let failed = 0;
  for (const g of toSync) {
    try {
      const norm = normalizeGuest({ ...g, event: { id: lumaEventId } } as LumaGuestData);
      const outcome = await ingestRegistration(norm, { live: false });
      if (outcome.status === "ingested") synced++;
    } catch (err) {
      failed++;
      await logSync({
        direction: "luma_in",
        result: "error",
        action: "invited_sync",
        note: `guest ${g.id}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  if (synced || failed) {
    await logSync({
      direction: "luma_in",
      result: "applied",
      action: "invited_sync",
      note: `${lumaEventId}: ${synced} synced, ${failed} failed, ${toSync.length} candidate(s)`,
    });
  }
  return { synced, failed };
}
