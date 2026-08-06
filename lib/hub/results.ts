import type { HubBooking, HubEvent, HubFeedback } from "./queries";
import { monthLabel } from "./format";

export interface EventResult {
  key: string; // luma_event_id ("__all__" for overall)
  label: string;
  // Attendance funnel
  registered: number;
  approved: number;
  checkedIn: number;
  noShow: number;
  attendanceRate: number; // checkedIn / approved, 0..1
  // 1:1 coverage
  oneOnOneRequested: number;
  oneOnOneClaimed: number;
  oneOnOneCompleted: number;
  // Satisfaction
  responses: number;
  responseRate: number; // responses / checkedIn, 0..1
  avgSatisfaction: number | null; // mean of non-null scores
}

const isActive = (b: HubBooking) => b.status !== "cancelled";
const hasHelper = (b: HubBooking) => !!b.booked_by_display_name;

function rollup(key: string, label: string, bookings: HubBooking[], feedback: HubFeedback[]): EventResult {
  const registered = bookings.filter(isActive).length;
  const approved = bookings.filter((b) => b.luma_status === "approved").length;
  const checkedIn = bookings.filter((b) => b.status === "checked_in").length;
  const noShow = bookings.filter((b) => b.status === "no_show").length;
  const oneOnOneRequested = bookings.filter((b) => !!b.requested_slot).length;
  const oneOnOneClaimed = bookings.filter(
    (b) => hasHelper(b) && (b.status === "assigned" || b.status === "checked_in"),
  ).length;
  const oneOnOneCompleted = bookings.filter((b) => b.status === "checked_in" && hasHelper(b)).length;
  const scores = feedback.map((f) => f.satisfaction_score).filter((n): n is number => n != null);
  const avgSatisfaction = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  return {
    key,
    label,
    registered,
    approved,
    checkedIn,
    noShow,
    attendanceRate: approved > 0 ? checkedIn / approved : 0,
    oneOnOneRequested,
    oneOnOneClaimed,
    oneOnOneCompleted,
    responses: feedback.length,
    responseRate: checkedIn > 0 ? feedback.length / checkedIn : 0,
    avgSatisfaction,
  };
}

/**
 * Pure aggregation for the results dashboard. Per-event rows (keyed by
 * luma_event_id) plus an overall total. Feedback with no matched event is
 * excluded from per-event rows but still counted in the overall total.
 */
export function computeResults(
  bookings: HubBooking[],
  feedback: HubFeedback[],
  events: HubEvent[],
): { overall: EventResult; perEvent: EventResult[] } {
  const labelFor = (luma: string) => {
    const e = events.find((ev) => ev.luma_event_id === luma);
    if (!e) return luma;
    return `${e.city ?? "—"} — ${monthLabel(e.event_date)}`.replace(/ — $/, "");
  };

  // Event order: follow the events list (chronological), only events that exist.
  const perEvent = events.map((e) => {
    const b = bookings.filter((x) => x.luma_event_id === e.luma_event_id);
    const f = feedback.filter((x) => x.luma_event_id === e.luma_event_id);
    return rollup(e.luma_event_id, labelFor(e.luma_event_id), b, f);
  });

  const overall = rollup("__all__", "All events", bookings, feedback);
  return { overall, perEvent };
}
