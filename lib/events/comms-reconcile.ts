/**
 * Backstop for claims whose DB assignment committed but whose `assigned` comms
 * never ran — e.g. the Notion→hub handler hit the Vercel function timeout after
 * `claimBooking` but before `sendBookingComms`. Such a booking has NO email_log
 * row at all, so the transient-failure retry (`listRetriableComms`) can't see it.
 *
 * This selects assigned bookings that are missing the `assigned` comm to their
 * current helper, so the comms-retry cron can re-drive them. Pure + unit-tested;
 * the DB fetch lives in `lib/db/bookings.ts`.
 */

export interface AssignedCommsCandidate {
  id: string;
  status: string | null;
  booked_by_email: string | null;
  updated_at: string;
}

/** Ledger key for "the `assigned` email to this helper" — email lowercased. */
export function assignedCommKey(bookingId: string, helperEmail: string): string {
  return `${bookingId}:${helperEmail.toLowerCase()}`;
}

/**
 * Return the ids of assigned bookings whose `assigned` comm to the current
 * helper has no ledger row yet. `sentKeys` holds `assignedCommKey(...)` for every
 * existing `assigned`/helper email_log row (any status). A grace window skips
 * bookings updated moments ago, so an in-flight claim finishing normally is never
 * pre-empted by the cron.
 */
export function selectBookingsNeedingAssignedComms(
  bookings: AssignedCommsCandidate[],
  sentKeys: Set<string>,
  nowMs: number,
  graceMs = 3 * 60_000,
): string[] {
  const out: string[] = [];
  for (const b of bookings) {
    if (b.status !== "assigned" || !b.booked_by_email) continue;
    if (nowMs - Date.parse(b.updated_at) < graceMs) continue;
    if (sentKeys.has(assignedCommKey(b.id, b.booked_by_email))) continue;
    out.push(b.id);
  }
  return out;
}
