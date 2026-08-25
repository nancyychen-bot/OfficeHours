import type { HubBooking, HubEvent, HubFeedback, LumaStats } from "./queries";
import { monthLabel } from "./format";

export interface EventResult {
  key: string; // luma_event_id ("__all__" for overall)
  label: string;
  attendanceSource: "luma" | "mirror";
  // Attendance funnel
  registered: number;
  approved: number;
  checkedIn: number;
  noShow: number;
  waitlist: number;
  attendanceRate: number; // checkedIn / approved
  // 1:1 coverage
  oneOnOneRequested: number;
  oneOnOneClaimed: number;
  oneOnOneCompleted: number;
  oneOnOneUnmet: number; // requested but never claimed
  // Satisfaction
  responses: number;
  responseRate: number; // responses / checkedIn
  avgSatisfaction: number | null;
  satisfactionDist: Record<1 | 2 | 3 | 4 | 5, number>;
  // Confidence lift
  confidence: { muchMore: number; somewhatMore: number; same: number; less: number; unknown: number };
  pctMoreConfident: number | null; // (much + somewhat) / answered
  // Interests + verbatim
  interests: Array<{ label: string; count: number }>;
  comments: Array<{ guestName: string | null; featureIntent: string | null; highlight: string | null }>;
}

const hasHelper = (b: HubBooking) => !!b.booked_by_display_name;

function attendanceFromBookings(bookings: HubBooking[]) {
  return {
    // Total ever registered: every mirrored booking, incl. declined/cancelled, so
    // the day-before auto-decline sweep never shrinks the number (mirror parity
    // with fetchEventStats' `registered`).
    registered: bookings.length,
    approved: bookings.filter((b) => b.luma_status === "approved").length,
    checkedIn: bookings.filter((b) => b.status === "checked_in").length,
    waitlist: bookings.filter((b) => b.luma_status === "waitlist").length,
  };
}

function oneOnOne(bookings: HubBooking[]) {
  const requested = bookings.filter((b) => !!b.requested_slot).length;
  const claimed = bookings.filter((b) => hasHelper(b) && (b.status === "assigned" || b.status === "checked_in")).length;
  const completed = bookings.filter((b) => b.status === "checked_in" && hasHelper(b)).length;
  return { requested, claimed, completed, unmet: Math.max(0, requested - claimed) };
}

function feedbackRollup(feedback: HubFeedback[]) {
  const dist: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const f of feedback) {
    const s = f.satisfaction_score;
    if (s && s >= 1 && s <= 5) dist[s as 1 | 2 | 3 | 4 | 5]++;
  }
  const scores = feedback.map((f) => f.satisfaction_score).filter((n): n is number => n != null);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  const conf = { muchMore: 0, somewhatMore: 0, same: 0, less: 0, unknown: 0 };
  for (const f of feedback) {
    const c = (f.confidence ?? "").toLowerCase();
    if (c.startsWith("much more")) conf.muchMore++;
    else if (c.startsWith("somewhat")) conf.somewhatMore++;
    else if (c.includes("same")) conf.same++;
    else if (c.startsWith("less")) conf.less++;
    else conf.unknown++;
  }
  const answered = conf.muchMore + conf.somewhatMore + conf.same + conf.less;
  const pctMoreConfident = answered > 0 ? (conf.muchMore + conf.somewhatMore) / answered : null;

  const interestCounts = new Map<string, number>();
  for (const f of feedback) for (const i of f.interests) interestCounts.set(i, (interestCounts.get(i) ?? 0) + 1);
  const interests = [...interestCounts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);

  const comments = feedback
    .filter((f) => f.feature_intent || f.highlight)
    .map((f) => ({ guestName: f.guest_name, featureIntent: f.feature_intent, highlight: f.highlight }));

  return { dist, avg, conf, pctMoreConfident, interests, comments, responses: feedback.length };
}

function buildResult(
  key: string,
  label: string,
  attendance: { registered: number; approved: number; checkedIn: number; waitlist: number },
  attendanceSource: "luma" | "mirror",
  noShow: number,
  bookings: HubBooking[],
  feedback: HubFeedback[],
): EventResult {
  const o = oneOnOne(bookings);
  const f = feedbackRollup(feedback);
  return {
    key,
    label,
    attendanceSource,
    registered: attendance.registered,
    approved: attendance.approved,
    checkedIn: attendance.checkedIn,
    waitlist: attendance.waitlist,
    noShow,
    attendanceRate: attendance.approved > 0 ? attendance.checkedIn / attendance.approved : 0,
    oneOnOneRequested: o.requested,
    oneOnOneClaimed: o.claimed,
    oneOnOneCompleted: o.completed,
    oneOnOneUnmet: o.unmet,
    responses: f.responses,
    responseRate: attendance.checkedIn > 0 ? f.responses / attendance.checkedIn : 0,
    avgSatisfaction: f.avg,
    satisfactionDist: f.dist,
    confidence: f.conf,
    pctMoreConfident: f.pctMoreConfident,
    interests: f.interests,
    comments: f.comments,
  };
}

function attendanceFromLuma(s: LumaStats) {
  return { registered: s.registered, approved: s.approved, checkedIn: s.checkedIn, waitlist: s.waitlist };
}

export function computeResults(
  bookings: HubBooking[],
  feedback: HubFeedback[],
  events: HubEvent[],
): { overall: EventResult; perEvent: EventResult[] } {
  const labelFor = (e: HubEvent) => `${e.city ?? "—"} — ${monthLabel(e.event_date)}`.replace(/ — $/, "");

  const perEvent = events.map((e) => {
    const b = bookings.filter((x) => x.luma_event_id === e.luma_event_id);
    const f = feedback.filter((x) => x.luma_event_id === e.luma_event_id);
    const noShow = b.filter((x) => x.status === "no_show").length;
    const attendance = e.luma_stats ? attendanceFromLuma(e.luma_stats) : attendanceFromBookings(b);
    return buildResult(e.luma_event_id, labelFor(e), attendance, e.luma_stats ? "luma" : "mirror", noShow, b, f);
  });

  // Overall attendance = sum of each event's resolved (luma-or-mirror) numbers.
  const sum = (pick: (r: EventResult) => number) => perEvent.reduce((a, r) => a + pick(r), 0);
  const overallAttendance = {
    registered: sum((r) => r.registered),
    approved: sum((r) => r.approved),
    checkedIn: sum((r) => r.checkedIn),
    waitlist: sum((r) => r.waitlist),
  };
  const overallNoShow = bookings.filter((b) => b.status === "no_show").length;
  const overall = buildResult("__all__", "All events", overallAttendance, "mirror", overallNoShow, bookings, feedback);

  return { overall, perEvent };
}

// ---- Community insights (cross-event) --------------------------------------

export interface Community {
  uniqueAttendees: number;
  repeatAttendees: number;
  repeatRate: number;
  top: Array<{ email: string; name: string | null; events: number }>;
}

/** Repeat attendance: checked-in guests grouped by email; ≥2 distinct events = repeat. */
export function computeCommunity(bookings: HubBooking[]): Community {
  const byEmail = new Map<string, { name: string | null; events: Set<string> }>();
  for (const b of bookings) {
    if (b.status !== "checked_in") continue;
    const email = (b.guest_email ?? b.notion_email ?? "").trim().toLowerCase();
    if (!email) continue;
    const rec = byEmail.get(email) ?? { name: b.guest_name ?? null, events: new Set<string>() };
    rec.events.add(b.luma_event_id);
    byEmail.set(email, rec);
  }
  const people = [...byEmail.entries()].map(([email, r]) => ({ email, name: r.name, events: r.events.size }));
  const uniqueAttendees = people.length;
  const repeatAttendees = people.filter((p) => p.events >= 2).length;
  return {
    uniqueAttendees,
    repeatAttendees,
    repeatRate: uniqueAttendees > 0 ? repeatAttendees / uniqueAttendees : 0,
    top: people.filter((p) => p.events >= 2).sort((a, b) => b.events - a.events).slice(0, 10),
  };
}

// ---- Contributors ("Voluntinos") -------------------------------------------

export interface Contributor {
  name: string;
  type: string | null; // employee | ambassador
  sessions: number; // completed (checked-in) 1:1s they hosted
  events: number; // distinct events they helped at
}

/** Top experts by completed 1:1s: checked-in bookings grouped by the person who
 * claimed them (booked_by). Counts real sessions (guest showed), not just claims. */
export function computeContributors(bookings: HubBooking[]): Contributor[] {
  const byKey = new Map<string, { name: string; type: string | null; sessions: number; events: Set<string> }>();
  for (const b of bookings) {
    if (b.status !== "checked_in") continue; // an actual, completed 1:1
    const name = (b.booked_by_display_name ?? "").trim();
    if (!name) continue;
    const key = (b.booked_by_email ?? name).trim().toLowerCase();
    const rec = byKey.get(key) ?? { name, type: b.booked_by_type ?? null, sessions: 0, events: new Set<string>() };
    rec.sessions += 1;
    rec.events.add(b.luma_event_id);
    if (!rec.type && b.booked_by_type) rec.type = b.booked_by_type;
    byKey.set(key, rec);
  }
  return [...byKey.values()]
    .map((r) => ({ name: r.name, type: r.type, sessions: r.sessions, events: r.events.size }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 10);
}
