import type { CommsKind, Recipient } from "../email/templates";

export type Audience = "guest" | "expert";
export type Phase = "before" | "matching_dayof" | "after" | "exception";
export type Trigger =
  | { kind: "schedule"; label: string; rule: { offsetDays: number; targetHour: number } }
  | { kind: "event"; label: string };

export interface FlowNode {
  id: string;
  audience: Audience;
  phase: Phase;
  label: string;
  detail?: string;
  commsKinds: CommsKind[];
  trigger: Trigger;
  recipientRole: Recipient;
}

const sched = (label: string, offsetDays: number, targetHour = 9): Trigger => ({ kind: "schedule", label, rule: { offsetDays, targetHour } });
const ev = (label: string): Trigger => ({ kind: "event", label });

export const FLOW_NODES: FlowNode[] = [
  // ---- GUEST ----
  { id: "g-prep", audience: "guest", phase: "before", label: "Prep — activate Notion AI / claim credits", commsKinds: ["prep_reminder"], trigger: sched("T−3d · 9am", -3), recipientRole: "guest" },
  { id: "g-daybefore", audience: "guest", phase: "before", label: "Tomorrow: your 1:1 + credits + logistics", detail: "merged day-before (slot + expert + credits + logistics)", commsKinds: ["prep_reminder_day_before", "prep_reminder_day_before_paid"], trigger: sched("T−1d · 9am", -1), recipientRole: "guest" },
  { id: "g-status", audience: "guest", phase: "before", label: "Waitlisted / Declined / Spot opened", commsKinds: ["waitlisted", "declined", "reapproved"], trigger: ev("on Luma status change"), recipientRole: "guest" },
  { id: "g-cowork", audience: "guest", phase: "before", label: "Cowork-only / unmatched notice", commsKinds: ["cowork_only", "rematch_pending", "unmatched_notice"], trigger: sched("day before", -1), recipientRole: "guest" },
  { id: "g-confirmed", audience: "guest", phase: "matching_dayof", label: "1:1 confirmed + calendar invite", detail: "expert clicks Claim OR the DRI sets \"Booked by\" in Notion → auto-approved in Luma", commsKinds: ["assigned"], trigger: ev("on claim / DRI assign"), recipientRole: "guest" },
  { id: "g-slotchanged", audience: "guest", phase: "matching_dayof", label: "Slot changed — new time + updated invite", detail: "manual Notion slot edit, or guest self-serve change-slot form", commsKinds: ["slot_changed"], trigger: ev("on slot edit"), recipientRole: "guest" },
  { id: "g-coworkaccept", audience: "guest", phase: "matching_dayof", label: "Cowork-only accepted", commsKinds: ["cowork_only_accept"], trigger: ev("organizer accepts for coworking"), recipientRole: "guest" },
  { id: "g-welcome", audience: "guest", phase: "matching_dayof", label: "Welcome (checked in)", commsKinds: ["checked_in", "arrived_after_no_show"], trigger: ev("at the door"), recipientRole: "guest" },
  { id: "g-feedback", audience: "guest", phase: "after", label: "Feedback request → reminder +2d", commsKinds: ["feedback_request", "feedback_reminder"], trigger: ev("event ends · T+2d"), recipientRole: "guest" },
  { id: "g-cancelled", audience: "guest", phase: "exception", label: "Cancelled / event cancelled", commsKinds: ["cancelled", "event_cancelled"], trigger: ev("cancellation"), recipientRole: "guest" },
  // ---- EXPERT ----
  { id: "e-assigned", audience: "expert", phase: "matching_dayof", label: "Assigned — you're helping {{guestName}} + invite", detail: "they click Claim OR the DRI assigns them in Notion · Slack DM too", commsKinds: ["assigned"], trigger: ev("on claim / DRI assign"), recipientRole: "helper" },
  { id: "e-agenda", audience: "expert", phase: "matching_dayof", label: "Day-of agenda — your 1:1 lineup", commsKinds: ["day_of_agenda"], trigger: sched("day-of · 9am", 0), recipientRole: "helper" },
  { id: "e-checkedin", audience: "expert", phase: "matching_dayof", label: "Your guest checked in", commsKinds: ["checked_in"], trigger: ev("at the door"), recipientRole: "helper" },
  { id: "e-noshow", audience: "expert", phase: "matching_dayof", label: "Guest no-show / arrived after", commsKinds: ["no_show", "arrived_after_no_show"], trigger: ev("slot +5m / late"), recipientRole: "helper" },
  { id: "e-slotchanged", audience: "expert", phase: "exception", label: "Slot changed / reassigned off / removed", commsKinds: ["slot_changed", "reassigned_off", "expert_unavailable"], trigger: ev("reassign / unclaim / slot edit"), recipientRole: "helper" },
  { id: "e-guestcancel", audience: "expert", phase: "exception", label: "Guest cancelled / double-booked / already-claimed / unclaim-denied", commsKinds: ["guest_cancelled", "double_booked", "already_claimed", "unclaim_denied"], trigger: ev("conflict / cancel"), recipientRole: "helper" },
];

/** Phases in display order. */
export const FLOW_PHASES: { id: Phase; label: string }[] = [
  { id: "before", label: "Before the event" },
  { id: "matching_dayof", label: "Matching & day of" },
  { id: "after", label: "After" },
  { id: "exception", label: "Exceptions" },
];

export function nodesFor(audience: Audience): FlowNode[] {
  return FLOW_NODES.filter((n) => n.audience === audience);
}
