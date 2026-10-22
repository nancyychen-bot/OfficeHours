import { isOurEventName } from "../readiness/untracked";

/**
 * Whether an event should appear on the hub dashboards + public embed. Two levers:
 *  - name: only our events (Build Bar / Office Hours) show — the shared Luma
 *    calendars host other Notion events (AI Labs, Cincinnati dinners, Notion 101…);
 *  - hidden: an explicit operator archive, for a same-named dupe/test you want gone.
 * Crons gate on the `hidden` flag alone (see lib/db/events.ts) so an archived event
 * goes fully inert.
 */
export function isDashboardEvent(e: { name: string | null; hidden?: boolean | null }): boolean {
  return isOurEventName(e.name) && !e.hidden;
}

/**
 * Keep only the bookings/feedback that belong to one of `events` (matched by
 * luma_event_id). Unattributed feedback (no luma_event_id) is kept so it still
 * shows in the overall roll-up as "couldn't be matched". Pure — the guard that
 * stops a hidden event's bookings (e.g. AI Labs' 354) from polluting the overall
 * numbers, community, and contributors, which read ALL bookings. `events` is the
 * already-visible list.
 */
export function filterToEvents<
  B extends { luma_event_id: string },
  F extends { luma_event_id: string | null },
>(
  events: { luma_event_id: string }[],
  bookings: B[],
  feedback: F[],
): { bookings: B[]; feedback: F[] } {
  const ids = new Set(events.map((e) => e.luma_event_id));
  return {
    bookings: bookings.filter((b) => ids.has(b.luma_event_id)),
    feedback: feedback.filter((f) => !f.luma_event_id || ids.has(f.luma_event_id)),
  };
}
