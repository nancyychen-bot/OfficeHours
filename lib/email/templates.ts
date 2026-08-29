export type CommsKind = "assigned" | "checked_in" | "no_show" | "cancelled" | "expert_unavailable" | "declined" | "waitlisted" | "event_cancelled" | "arrived_after_no_show" | "double_booked" | "feedback_request" | "feedback_reminder" | "prep_reminder" | "rematch_pending" | "unmatched_notice" | "reassigned_off" | "already_claimed" | "day_of_agenda" | "unclaim_denied" | "slot_changed" | "prep_reminder_day_before" | "cowork_only" | "guest_cancelled" | "prep_reminder_day_before_paid";
export type Recipient = "helper" | "guest";

/** The Ambassador feedback form (linked from the post-event feedback email). */
export const FEEDBACK_FORM_URL = "https://notionambassadors.notion.site/ef74dccc30f7477fac1136b4ff7faeb7?pvs=105";
/** Notion AI free-trial claim link (pre-event prep email). */
export const NOTION_AI_TRIAL_URL = "http://ntn.so/community-biz";
export const CALENDAR_URL = "https://luma.com/calendar/cal-ZDQrtBgbNzSJZkh";
export const SUPPORT_EMAIL = "communityevents@makenotion.com";
export const SLOT_CHANGE_URL = "https://office-hours-three.vercel.app/change-slot";

export interface CommsFields {
  bookingId: string;
  guestName: string;
  guestEmail: string | null;
  company: string | null;
  role: string | null;
  challenge: string | null;
  guestPhone: string | null;
  slotName: string | null;
  slotStartsAt: string | null;
  slotEndsAt: string | null;
  eventName: string | null;
  eventDate: string | null;
  location: string | null;
  /** Specific street address (from the Luma event); preferred over city in the invite. */
  address: string | null;
  helperName: string | null;
  helperEmail: string | null;
  status: string;
  slotId: string | null;
  /** The event's public Luma URL (for "cancel your registration"). */
  eventUrl?: string | null;
  /** The event's city/calendar-specific public Luma calendar URL (for "follow our
   * calendar"); falls back to the global CALENDAR_URL when unset. */
  calendarUrl?: string | null;
  /** Other bookings the expert holds in this slot (populated for the double-booked email). */
  conflicts?: Array<{ name: string; challenge: string | null; role: string | null; company: string | null }>;
}

// ---- shared helpers ---------------------------------------------------------

/** The internal "Guest details" block, omitting absent optionals. */
export function guestDetailsLines(f: CommsFields): string[] {
  const lines = [
    `Guest Name: ${f.guestName}`,
    `Guest Email: ${f.guestEmail ?? "—"}`,
    `Challenge: ${f.challenge ?? "—"}`,
    `Date: ${f.eventDate ?? "—"}`,
    `Time Slot: ${f.slotName ?? "—"}`,
    `Location: ${f.location ?? "—"}`,
  ];
  if (f.role) lines.push(`Role: ${f.role}`);
  if (f.company) lines.push(`Company: ${f.company}`);
  if (f.guestPhone) lines.push(`Guest phone: ${f.guestPhone}`);
  if (f.eventName) lines.push(`Event: ${f.eventName}`);
  return lines;
}

function firstName(full: string | null | undefined, fallback = "there"): string {
  const n = (full ?? "").trim().split(/\s+/)[0];
  return n || fallback;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-08-28" → "Aug 28" (no timezone parsing so the date never shifts). */
function shortDate(isoDate: string): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return isoDate;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

/** A warm, guest-facing session summary — only the lines we actually have. */
function guestSessionLines(f: CommsFields): string[] {
  const lines: string[] = [];
  if (f.eventDate) lines.push(`🗓  ${f.eventDate}`);
  if (f.slotName) lines.push(`⏰  ${f.slotName}`);
  const place = f.address ?? f.location;
  if (place) lines.push(`📍  ${place}`);
  if (f.helperName) lines.push(`🧑‍💻  With ${f.helperName}`);
  return lines;
}

/** Clean, guest-facing calendar-invite body (the .ics DESCRIPTION). */
/** "Christina, Product Manager at Acme" — adapts to whichever of role/company exist. */
function guestContextLine(f: CommsFields): string {
  if (f.role && f.company) return `${f.guestName}, ${f.role} at ${f.company}`;
  if (f.role) return `${f.guestName}, ${f.role}`;
  if (f.company) return `${f.guestName} (${f.company})`;
  return f.guestName;
}

export function inviteDescription(f: CommsFields, role: Recipient = "guest"): string {
  const place = f.address ?? f.location;

  // Expert (helper) variant: framed for the expert, with who they're meeting and
  // what the guest wants help with — so they can prep before the 1:1.
  if (role === "helper") {
    const lines = ["You're confirmed as the Notion expert for a Notion Build Bar 1:1! Details:", ""];
    if (f.slotName) lines.push(`Time slot: ${f.slotName}`);
    if (place) lines.push(`Location: ${place}`);
    lines.push(`Meeting: ${guestContextLine(f)}`);
    if (f.challenge) lines.push(`What they'd like help with: ${f.challenge}`);
    lines.push("");
    lines.push("Please arrive 5 minutes before the start of your booking.");
    return lines.join("\n");
  }

  // Guest variant (unchanged): names their assigned expert.
  const lines = ["You're confirmed for your Notion Build Bar 1:1! Details:", ""];
  if (f.slotName) lines.push(`Time slot: ${f.slotName}`);
  if (place) lines.push(`Location: ${place}`);
  if (f.helperName) lines.push(`Your Notion expert: ${f.helperName}`);
  lines.push("");
  lines.push("Please arrive 5 minutes before the start of your booking.");
  return lines.join("\n");
}

// ---- formatting (inline markdown → html/text) -------------------------------

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/** Group lines into paragraphs: a BLANK line starts a new paragraph; consecutive
 * non-blank lines stay together (joined with <br/>), so signatures, checklists,
 * and detail blocks read tight instead of each line getting its own big gap. */
function toParagraphs(bodyLines: string[], fmt: (s: string) => string): string {
  const paras: string[][] = [];
  let cur: string[] = [];
  for (const l of bodyLines) {
    if (l.trim() === "") { if (cur.length) { paras.push(cur); cur = []; } }
    else cur.push(l);
  }
  if (cur.length) paras.push(cur);
  return paras
    .map((p) => `<p style="margin:0 0 10px;line-height:1.45">${p.map(fmt).join("<br/>")}</p>`)
    .join("");
}
function inlineFormat(s: string): string {
  let out = escapeHtml(s);
  // All links render bold so they clearly read as links (applies everywhere).
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" style="font-weight:700">$1</a>');
  out = out.replace(/(^|[^"=>])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" style="font-weight:700">$2</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return out;
}
function stripInline(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1: $2")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1");
}
function wrapRich(bodyLines: string[]): { html: string; text: string } {
  return { text: bodyLines.map(stripInline).join("\n"), html: toParagraphs(bodyLines, inlineFormat) };
}

// ---- editable template registry --------------------------------------------

export type TemplateKey =
  | "prep_reminder__guest"
  | "prep_reminder_day_before__guest"
  | "prep_reminder_day_before_paid__guest"
  | "day_of_agenda__helper"
  | "assigned__guest" | "assigned__helper"
  | "checked_in__guest__matched" | "checked_in__guest__unmatched" | "checked_in__guest__nohelp" | "checked_in__helper"
  | "arrived_after_no_show__guest__matched" | "arrived_after_no_show__guest__nohelp" | "arrived_after_no_show__helper"
  | "no_show__helper"
  | "rematch_pending__guest" | "unmatched_notice__guest" | "expert_unavailable__helper"
  | "double_booked__helper" | "reassigned_off__helper" | "already_claimed__helper" | "unclaim_denied__helper"
  | "slot_changed__guest" | "slot_changed__helper"
  | "waitlisted__guest" | "waitlisted__helper"
  | "declined__guest" | "declined__helper"
  | "guest_cancelled__helper"
  | "cancelled__guest" | "cancelled__helper"
  | "event_cancelled__guest" | "event_cancelled__helper"
  | "feedback_request__guest"
  | "feedback_reminder__guest"
  | "cowork_only__guest";

export interface TemplateDef {
  label: string;
  description: string;
  role: Recipient;
  subject: string;
  body: string;
}

const SIGNOFF = "The Notion Community Team";
const SUPPORT = `If you have any questions please email ${SUPPORT_EMAIL}`;
const SUPPORT_HELPER = "If you have any questions, please talk to Nancy Chen";
const b = (...lines: string[]) => lines.join("\n");

export const TEMPLATE_REGISTRY: Record<TemplateKey, TemplateDef> = {
  prep_reminder__guest: {
    label: "Prep reminder", description: "3 days before — approved guests", role: "guest",
    subject: "One thing to do before Notion Build Bar ✨",
    body: b(
      "Hi {{firstName}},", "",
      "You're **confirmed for Notion Build Bar** — we can't wait to build with you!", "",
      `Before you arrive, if you don't already have Notion AI on, **[start your free Notion AI trial]({{trialLink}})** — it takes about a minute. Your host will use Notion AI to help you draft, summarize, and structure faster, so you'll get much more out of your session with it on.`, "",
      "**Quick checklist:**",
      "✅ Your 1:1 slot — check for the calendar invite (if you have one)",
      "✅ Notion AI activated",
      "✅ Laptop + the question or workspace you want help with", "",
      "Please **[cancel your registration]({{eventUrl}})** if you can't make it, so we can free up your spot.", "",
      "Need a different time? **[Change your slot]({{slotChangeLink}})** and we'll help reassign you.", "",
      "See you soon,", SIGNOFF, "", `*${SUPPORT}*`,
    ),
  },
  prep_reminder_day_before__guest: {
    label: "Prep reminder — day before", description: "1 day before — approved Free-plan guests", role: "guest",
    subject: "Your Notion Build Bar 1:1 is tomorrow ✨",
    body: b(
      "Hi {{firstName}},", "",
      "Quick reminder — your **Notion Build Bar** session is **tomorrow**. We can't wait to build with you!", "",
      "**Quick checklist:**",
      "✅ Your 1:1 slot — check for the calendar invite (if you have one)",
      "✅ Arrive 10 minutes early for your 1:1 (if you have one)",
      "✅ Notion AI activated — if you haven't yet, **[start your free Notion AI trial]({{trialLink}})** (about a minute)",
      "✅ Laptop + the question or workspace you want help with", "",
      "Can't make it? Please **[cancel your registration]({{eventUrl}})** so we can free up your spot.", "",
      "See you tomorrow,", SIGNOFF, "", `*${SUPPORT}*`,
    ),
  },
  prep_reminder_day_before_paid__guest: {
    label: "Prep reminder — day before (non-Free)", description: "1 day before — approved guests not on Free", role: "guest",
    subject: "Your Notion Build Bar 1:1 is tomorrow ✨",
    body: b(
      "Hi {{firstName}},", "",
      "Quick reminder — your **Notion Build Bar** session is **tomorrow**. We can't wait to build with you!", "",
      "**What to bring:**",
      "✅ Your 1:1 slot — check for the calendar invite (if you have one)",
      "✅ Arrive 10 minutes early for your 1:1 (if you have one)",
      "✅ Your laptop", "",
      "Can't make it? Please **[cancel your registration]({{eventUrl}})** so we can free up your spot.", "",
      "See you tomorrow,", SIGNOFF, "", `*${SUPPORT}*`,
    ),
  },
  cowork_only__guest: {
    label: "Cowork-only notice", description: "approved, no slot, asked for 1:1 — coworking only", role: "guest",
    subject: "You're approved to cowork at the Notion Build Bar (no 1:1 slot booked)",
    body: b(
      "Hi {{firstName}},", "",
      "You've been **approved to join us at the Notion Build Bar** in {{location}} on {{eventDate}} to **cowork** alongside Notion experts. We're excited to have you!", "",
      "One heads-up so you know what to expect: because a **1:1 time slot wasn't selected** during registration, you **won't be paired with a Notion expert for dedicated one-on-one help**. You're very welcome to come cowork, ask questions, and meet the team.", "",
      "Can't make it? Please **[cancel your registration]({{eventUrl}})** so we can free up your spot.", "",
      "See you there,", SIGNOFF, "", `*${SUPPORT}*`,
    ),
  },
  assigned__guest: {
    label: "1:1 confirmed", description: "expert claims a booking (calendar invite attached)", role: "guest",
    subject: "📅 Invitation: your Notion Build Bar 1:1 — {{eventDate}}",
    body: b(
      "Hi {{firstName}},", "",
      "Great news — your 1:1 at Notion Build Bar is confirmed, and {{expertName}} will be your Notion expert. We can't wait to build with you!", "",
      "Here's your session:",
      "{{sessionDetails}}", "",
      "📅 A calendar invite is attached so the time is locked in.", "",
      "Can't make it? Please [cancel your registration]({{eventUrl}}) to free up the spot for someone else.", "",
      "Need a different time? [Change your slot]({{slotChangeLink}}) and we'll help reassign you.", "",
      SUPPORT, "", "See you soon,", SIGNOFF,
    ),
  },
  assigned__helper: {
    label: "1:1 assigned", description: "expert claims a booking", role: "helper",
    subject: "📅 Invitation: you're helping {{guestName}} at Notion Build Bar",
    body: b(
      "Hi {{firstName}},", "",
      "Thanks for jumping in! You've claimed a 1:1 at Notion Build Bar — here's who you'll be helping:", "",
      "{{guestDetails}}", "",
      "📅 A calendar invite (.ics) is attached — open it to add this 1:1 to your calendar.", "",
      "Come ready to help them leave with something that actually works. If anything changes, unclaim the card and we'll find them a new match.", "",
      SUPPORT_HELPER, "", "Thanks for building with us,", SIGNOFF,
    ),
  },
  day_of_agenda__helper: {
    label: "Day-of agenda", description: "morning-of schedule sent to each expert", role: "helper",
    subject: "📅 Your Notion Build Bar schedule today",
    body: b(
      "Hi {{firstName}},", "",
      "Here's your 1:1 lineup for {{eventName}} today — please arrive a few minutes early.", "",
      "{{agenda}}", "",
      "Thanks for helping people build today!", "",
      SUPPORT_HELPER, "", "See you there,", SIGNOFF,
    ),
  },
  checked_in__guest__matched: {
    label: "Checked in — expert matched", description: "guest checks in, expert assigned", role: "guest",
    subject: "You're checked in — welcome to Build Bar 👋",
    body: b(
      "Hi {{firstName}},", "",
      "You're all checked in — welcome to Notion Build Bar! {{expertName}} will be with you shortly.", "",
      "Settle in, open your workspace, and get ready to build. If you need anything, just flag someone on the Community team.", "",
      SUPPORT, "", "See you inside,", SIGNOFF,
    ),
  },
  checked_in__guest__unmatched: {
    label: "Checked in — no expert", description: "guest wanted a 1:1 but wasn't matched", role: "guest",
    subject: "You're checked in — welcome to Build Bar 👋",
    body: b(
      "Hi {{firstName}},", "",
      "You're all checked in — welcome to Notion Build Bar! We weren't able to match you with a Notion expert this time, but you're very welcome to cowork out of the space.", "",
      "Settle in, open your workspace, and get ready to build. If you need anything, just flag someone on the Community team.", "",
      SUPPORT, "", "See you inside,", SIGNOFF,
    ),
  },
  checked_in__guest__nohelp: {
    label: "Checked in — no 1:1 requested", description: "guest didn't request a 1:1", role: "guest",
    subject: "You're checked in — welcome to Build Bar 👋",
    body: b(
      "Hi {{firstName}},", "",
      "You're all checked in — welcome to Notion Build Bar! Feel free to cowork, grab a coffee and a snack.", "",
      "Settle in, open your workspace, and get ready to build. If you need anything, just flag someone on the Community team.", "",
      SUPPORT, "", "See you inside,", SIGNOFF,
    ),
  },
  checked_in__helper: {
    label: "Checked in", description: "guest checks in at the door", role: "helper",
    subject: "{{guestName}} just checked in",
    body: b(
      "Hi {{firstName}},", "",
      "Your guest {{guestName}} has arrived and is checked in. A quick refresher before you meet:", "",
      "{{guestDetails}}", "",
      SUPPORT_HELPER, "", "Head over whenever you're ready. Thanks for building with us,", SIGNOFF,
    ),
  },
  arrived_after_no_show__guest__matched: {
    label: "Arrived after no-show — expert matched", description: "guest checks in after being marked no-show", role: "guest",
    subject: "You're checked in — welcome to Build Bar 👋",
    body: b(
      "Hi {{firstName}},", "",
      "You're all checked in — welcome to Notion Build Bar! {{expertName}} will be with you shortly.", "",
      "If you need anything, just flag someone on the Community team.", "",
      SUPPORT, "", "See you inside,", SIGNOFF,
    ),
  },
  arrived_after_no_show__guest__nohelp: {
    label: "Arrived after no-show — no expert", description: "late check-in, no expert", role: "guest",
    subject: "You're checked in — welcome to Build Bar 👋",
    body: b(
      "Hi {{firstName}},", "",
      "You're all checked in — welcome to Notion Build Bar! We weren't able to match you with a Notion expert this time, but you're very welcome to cowork out of the space.", "",
      "If you need anything, just flag someone on the Community team.", "",
      SUPPORT, "", "See you inside,", SIGNOFF,
    ),
  },
  arrived_after_no_show__helper: {
    label: "Arrived after no-show", description: "guest checks in after being marked no-show", role: "helper",
    subject: "{{guestName}} showed up — they just checked in",
    body: b(
      "Hi {{firstName}},", "",
      "Update: {{guestName}} was marked a no-show, but they've since checked in and are here. If you're still around, head over whenever you're ready.", "",
      "{{guestDetails}}", "",
      SUPPORT_HELPER, "", "Thanks for building with us,", SIGNOFF,
    ),
  },
  no_show__helper: {
    label: "No-show", description: "guest never checked in (5 min after slot start)", role: "helper",
    subject: "No-show: {{guestName}}",
    body: b(
      "Hi {{firstName}},", "",
      "Heads up — {{guestName}} didn't check in for their slot, so we've marked it as a no-show. Nothing you need to do; the slot has been freed up.", "",
      "{{guestDetails}}", "",
      SUPPORT_HELPER, "", "Thanks for being here,", SIGNOFF,
    ),
  },
  rematch_pending__guest: {
    label: "Re-match pending (day before)", description: "the day before, a 1:1 guest still has no expert", role: "guest",
    subject: "An update on your Notion Build Bar 1:1",
    body: b(
      "Hi {{firstName}},", "",
      "We're really sorry — the Notion expert for your 1:1 is no longer able to help at Notion Build Bar. We know that's disappointing, and we apologize for the change.", "",
      "You're very welcome to still come and cowork out of the space with us — we'd love to have you.", "",
      SUPPORT, "", "See you soon,", SIGNOFF,
    ),
  },
  unmatched_notice__guest: {
    label: "Couldn't match (day before)", description: "the day before, an approved 1:1 guest was never matched", role: "guest",
    subject: "An update on your Notion Build Bar 1:1",
    body: b(
      "Hi {{firstName}},", "",
      "Thank you for requesting a 1:1 at Notion Build Bar. Unfortunately, we weren't able to match you with a Notion expert this time.", "",
      "You're very welcome to still come and cowork out of the space with us. And to catch a 1:1 at a future event, follow our Notion calendar:", "",
      "👉 {{calendarLink}}", "",
      SUPPORT, "", "See you soon,", SIGNOFF,
    ),
  },
  already_claimed__helper: {
    label: "Already claimed", description: "someone clicked Claim on a slot that's already taken", role: "helper",
    subject: "That Notion Build Bar slot is already claimed",
    body: b(
      "Hi there,", "",
      "Thanks for jumping in! That 1:1 slot at Notion Build Bar is already claimed by {{expertName}}, so you're not booked for it.", "",
      "If you'd like to take it, ask {{expertName}} to unclaim it first — then it'll open up and you can claim it.", "",
      SUPPORT_HELPER, "", "Thanks for building with us,", SIGNOFF,
    ),
  },
  unclaim_denied__helper: {
    label: "Unclaim refused", description: "someone who isn't the claimer tried to unclaim a spot", role: "helper",
    subject: "That 1:1 isn't yours to unclaim",
    body: b(
      "Hi there,", "",
      "It looks like you tried to unclaim a 1:1 at Notion Build Bar that's currently claimed by {{expertName}}. Only the person who claimed a spot can unclaim it, so nothing has changed.", "",
      "If you'd like this spot, ask {{expertName}} to unclaim it — or talk to Nancy Chen to have it changed.", "",
      "Thanks for building with us,", SIGNOFF,
    ),
  },
  slot_changed__guest: {
    label: "Slot changed", description: "guest changed their 1:1 time via the self-serve form", role: "guest",
    subject: "Your 1:1 is now {{slotName}} — we'll match you with a new Notion expert",
    body: b(
      "Hi {{firstName}},", "",
      "Your 1:1 time has been changed to {{slotName}} on {{eventDate}} — you're still all set to attend.", "",
      "We'll do our best to match you with a Notion expert for the new time, and you'll get a calendar invite by email once you're matched. (We've cleared your previous calendar hold in the meantime.)", "",
      SUPPORT, "", "See you soon,", SIGNOFF,
    ),
  },
  slot_changed__helper: {
    label: "Slot changed (expert removed)", description: "a guest moved their 1:1 to a new time", role: "helper",
    subject: "A 1:1 you claimed changed time — you've been removed",
    body: b(
      "Hi {{firstName}},", "",
      "The guest for a 1:1 you'd claimed at Notion Build Bar moved to a new time ({{slotName}}), so you've been removed from this booking and the calendar hold has been cancelled. Nothing you need to do.", "",
      "If they still need help at the new time, the spot will be offered again.", "",
      SUPPORT_HELPER, "", "Thanks for building with us,", SIGNOFF,
    ),
  },
  reassigned_off__helper: {
    label: "Reassigned off", description: "you changed 'Booked by' to a different expert", role: "helper",
    subject: "You've been taken off {{guestName}}'s 1:1",
    body: b(
      "Hi {{firstName}},", "",
      "{{guestName}}'s 1:1 at Notion Build Bar has been reassigned to another Notion expert, so it's no longer on your plate. The calendar hold has been removed — nothing you need to do.", "",
      SUPPORT_HELPER, "", "Thanks for building with us,", SIGNOFF,
    ),
  },
  expert_unavailable__helper: {
    label: "Expert unavailable / unclaimed", description: "an expert releases a booking", role: "helper",
    subject: "You've released {{guestName}}'s 1:1",
    body: b(
      "Hi {{firstName}},", "",
      "You've unclaimed {{guestName}}'s 1:1, so it's back in the queue for another Notion expert. The calendar hold has been removed from your calendar — nothing else to do.", "",
      SUPPORT_HELPER, "", "Thanks for building with us,", SIGNOFF,
    ),
  },
  double_booked__helper: {
    label: "Double-booked", description: "expert claims 2+ guests in the same slot", role: "helper",
    subject: "Heads up — you've double-booked at {{slotName}}",
    body: b(
      "Hi {{firstName}},", "",
      "You've claimed more than one guest at {{slotName}}. You can only meet one at a time — please unclaim one so another Notion expert can take it:", "",
      "{{conflictSummary}}", "",
      SUPPORT_HELPER, "", "Thanks for building with us,", SIGNOFF,
    ),
  },
  waitlisted__guest: {
    label: "Waitlisted", description: "Luma Status set to Waitlist", role: "guest",
    subject: "You're on the waitlist for Notion Build Bar",
    body: b(
      "Hi {{firstName}},", "",
      "Thanks for your interest in Notion Build Bar! We're currently at capacity, so you're on the waitlist for now. If a spot opens up, we'll email you right away.", "",
      "You're also welcome to follow our Notion calendar for future events:", "",
      "👉 {{calendarLink}}", "",
      SUPPORT, "", "With gratitude,", SIGNOFF,
    ),
  },
  waitlisted__helper: {
    label: "Waitlisted (slot freed)", description: "guest moved to waitlist", role: "helper",
    subject: "Slot freed — {{guestName}} moved to the waitlist",
    body: b(
      "Hi {{firstName}},", "",
      "Quick update: {{guestName}} has been moved to the waitlist, so the slot you'd claimed has been released. Nothing you need to do.", "",
      SUPPORT_HELPER, "", "Thanks for building with us,", SIGNOFF,
    ),
  },
  // declined__* fires only from the organizer/cron decline path (applyLumaStatus).
  // A guest self-cancellation uses guest_cancelled__helper instead.
  declined__guest: {
    label: "Declined (at capacity)", description: "Luma Status set to Declined", role: "guest",
    subject: "An update on your Notion Build Bar booking",
    body: b(
      "Hi {{firstName}},", "",
      "Thank you so much for your interest in Notion Build Bar! Unfortunately, we've reached capacity for this event and aren't able to accommodate your booking this time.", "",
      "We're genuinely sorry to miss you — please follow our Notion calendar for future events. We'd love to build with you at the next one:", "",
      "👉 {{calendarLink}}", "",
      SUPPORT, "", "With gratitude,", SIGNOFF,
    ),
  },
  declined__helper: {
    label: "Declined (slot freed)", description: "guest won't be joining", role: "helper",
    subject: "Slot freed — {{guestName}} won't be joining",
    body: b(
      "Hi {{firstName}},", "",
      "Quick update: {{guestName}}'s 1:1 has been cancelled (we're at capacity and they won't be joining), so the slot you'd claimed has been released. Nothing you need to do.", "",
      SUPPORT_HELPER, "", "Thanks for building with us,", SIGNOFF,
    ),
  },
  guest_cancelled__helper: {
    label: "Guest cancelled (slot freed)", description: "guest self-cancelled on Luma — expert notified", role: "helper",
    subject: "Slot freed — {{guestName}} won't be joining",
    body: b(
      "Hi {{firstName}},", "",
      "Quick update: {{guestName}} has cancelled their booking and won't be joining, so the slot you'd claimed has been released.", "",
      "Want to pick up another? Head to your city's Build Bar Slack channel to claim an open 1:1 — we'd love to keep you building.", "",
      SUPPORT_HELPER, "", "Thanks for building with us,", SIGNOFF,
    ),
  },
  cancelled__guest: {
    label: "Cancelled", description: "guest cancels their registration", role: "guest",
    subject: "Your Notion Build Bar 1:1 was cancelled",
    body: b(
      "Hi {{firstName}},", "",
      `Your 1:1 at Notion Build Bar has been cancelled. If this was a surprise — or you'd like to grab another time — just email ${SUPPORT_EMAIL}.`, "",
      "You're still very welcome to come cowork with us. The door's open.", "",
      SUPPORT, "", "Thanks,", SIGNOFF,
    ),
  },
  cancelled__helper: {
    label: "Cancelled (slot freed)", description: "guest cancels their registration", role: "helper",
    subject: "Slot freed — {{guestName}}'s 1:1 was cancelled",
    body: b(
      "Hi {{firstName}},", "",
      "Quick update: the 1:1 you'd claimed with {{guestName}} has been cancelled, so the slot has been released. Nothing you need to do.", "",
      SUPPORT_HELPER, "", "Thanks for building with us,", SIGNOFF,
    ),
  },
  event_cancelled__guest: {
    label: "Event cancelled", description: "the whole event is cancelled", role: "guest",
    subject: "Notion Build Bar has been cancelled",
    body: b(
      "Hi {{firstName}},", "",
      "We're really sorry — Notion Build Bar has been cancelled, so your booking won't go ahead. We sincerely apologize for the disappointment.", "",
      "We'd still love to build with you — please follow our Notion calendar for upcoming events:", "",
      "👉 {{calendarLink}}", "",
      SUPPORT, "", "With gratitude,", SIGNOFF,
    ),
  },
  event_cancelled__helper: {
    label: "Event cancelled", description: "the whole event is cancelled", role: "helper",
    subject: "Event cancelled — {{guestName}}'s 1:1 is off",
    body: b(
      "Hi {{firstName}},", "",
      "Notion Build Bar has been cancelled, so your 1:1 with {{guestName}} won't happen. The calendar hold has been removed — nothing you need to do.", "",
      SUPPORT_HELPER, "", "Thanks for building with us,", SIGNOFF,
    ),
  },
  feedback_request__guest: {
    label: "Feedback request", description: "the minute the event ends — checked-in guests", role: "guest",
    subject: "How was Notion Build Bar? (2 mins) 💜",
    body: b(
      "Hi {{firstName}},", "",
      "Thank you so much for coming to **Notion Build Bar** — it was so great to have you, and we hope you left with something you're excited to build.", "",
      "We'd love to hear how it went — it takes about **2 minutes**, and your feedback directly shapes the next event.", "",
      "👉 **[Share your feedback]({{feedbackLink}})**", "",
      "*If you worked one-on-one with a Notion expert, we'd especially love to hear how that went.*", "",
      "To catch a future Build Bar or community event, follow our **[Notion calendar]({{calendarLink}})**.", "",
      "With gratitude,", SIGNOFF, "", `*${SUPPORT}*`,
    ),
  },
  feedback_reminder__guest: {
    label: "Feedback reminder", description: "2 days after — checked-in guests who haven't responded", role: "guest",
    subject: "One more nudge — we'd still love your Build Bar feedback 💜",
    body: b(
      "Hi {{firstName}},", "",
      "Thank you again for coming to **Notion Build Bar** — it was so great to have you, and we hope you left with something you're excited to build.", "",
      "We haven't heard from you yet, and we'd still really love to know how it went — it takes about **2 minutes**, and your feedback directly shapes the next event.", "",
      "👉 **[Share your feedback]({{feedbackLink}})**", "",
      "*If you worked one-on-one with a Notion expert, we'd especially love to hear how that went.*", "",
      "To catch a future Build Bar or community event, follow our **[Notion calendar]({{calendarLink}})**.", "",
      "With gratitude,", SIGNOFF, "", `*${SUPPORT}*`,
    ),
  },
};

/** The placeholder tokens available in templates, for the editor legend. */
export const PLACEHOLDERS: Array<{ token: string; desc: string }> = [
  { token: "{{firstName}}", desc: "Recipient's first name (guest or expert)" },
  { token: "{{guestName}}", desc: "Guest's full name" },
  { token: "{{expertName}}", desc: "Assigned Notion expert's name" },
  { token: "{{slotName}}", desc: "Time slot, e.g. 2:00–2:30 PM" },
  { token: "{{eventDate}}", desc: "Event date, e.g. Aug 28" },
  { token: "{{location}}", desc: "Address or city" },
  { token: "{{sessionDetails}}", desc: "Guest session summary block (date/time/place/expert)" },
  { token: "{{guestDetails}}", desc: "Full guest details block (for expert emails)" },
  { token: "{{conflictSummary}}", desc: "Overlapping bookings for the double-booked email (name — role, company — challenge)" },
  { token: "{{feedbackLink}}", desc: "Feedback form URL" },
  { token: "{{trialLink}}", desc: "Notion AI trial URL" },
  { token: "{{calendarLink}}", desc: "Notion community calendar URL" },
  { token: "{{eventUrl}}", desc: "This event's public Luma page (for cancel/registration links)" },
  { token: "{{supportEmail}}", desc: "Community support email" },
];

// ---- rendering --------------------------------------------------------------

/** Build the placeholder values for a given recipient + booking. */
export function buildVars(role: Recipient, f: CommsFields): Record<string, string> {
  const conflicts = f.conflicts && f.conflicts.length
    ? f.conflicts
    : [{ name: f.guestName, challenge: f.challenge, role: f.role, company: f.company }];
  const conflictSummary = conflicts
    .map((c) => {
      const who = [c.role, c.company].filter(Boolean).join(", ");
      const parts = [c.name];
      if (who) parts.push(who);
      if (c.challenge) parts.push(`Challenge: ${c.challenge}`);
      return `• ${parts.join(" — ")}`;
    })
    .join("\n");
  return {
    conflictSummary,
    firstName: firstName(role === "helper" ? f.helperName : f.guestName),
    guestName: f.guestName,
    expertName: f.helperName ?? "your Notion expert",
    slotName: f.slotName ?? "",
    eventDate: f.eventDate ? shortDate(f.eventDate) : "",
    location: f.address ?? f.location ?? "",
    sessionDetails: guestSessionLines(f).join("\n"),
    guestDetails: guestDetailsLines(f).join("\n"),
    feedbackLink: FEEDBACK_FORM_URL,
    slotChangeLink: SLOT_CHANGE_URL,
    trialLink: NOTION_AI_TRIAL_URL,
    // Per-city calendar when the event's calendar has one configured; else the
    // global community calendar (unchanged behavior).
    calendarLink: f.calendarUrl || CALENDAR_URL,
    // The event's public page; falls back to the community calendar so the link is never broken.
    eventUrl: f.eventUrl || CALENDAR_URL,
    supportEmail: SUPPORT_EMAIL,
  };
}

/** Replace {{token}} with known values; unknown tokens are left untouched. */
export function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** Tidy a substituted subject: drop empty "()", dangling "— "/"at", collapse spaces. */
function cleanupSubject(s: string): string {
  return s.replace(/\s*\(\s*\)/g, "").replace(/\s+(—|at)\s*$/i, "").replace(/\s{2,}/g, " ").trim();
}

/** Render an editable template's subject + body against placeholder values. */
export function renderTemplate(content: { subject: string; body: string }, vars: Record<string, string>): { subject: string; html: string; text: string } {
  const subject = cleanupSubject(substitute(content.subject, vars));
  const lines = substitute(content.body, vars).split("\n");
  return { subject, ...wrapRich(lines) };
}

/** Pick the editable template key for a (kind, role, context), or null. */
export function templateKeyFor(kind: CommsKind, role: Recipient, f: CommsFields): TemplateKey | null {
  if (kind === "checked_in" && role === "guest")
    return f.helperName ? "checked_in__guest__matched" : f.slotName ? "checked_in__guest__unmatched" : "checked_in__guest__nohelp";
  if (kind === "arrived_after_no_show" && role === "guest")
    return f.helperName ? "arrived_after_no_show__guest__matched" : "arrived_after_no_show__guest__nohelp";
  const key = `${kind}__${role}`;
  return key in TEMPLATE_REGISTRY ? (key as TemplateKey) : null;
}

export type OverrideMap = Map<string, { subject?: string | null; body?: string | null }>;

/**
 * Render subject + html + text for a kind×recipient, or null if none applies.
 * `overrides` (published copy from the DB) wins over the built-in default,
 * per field, with the default as the fallback.
 */
export function renderComms(
  kind: CommsKind,
  role: Recipient,
  f: CommsFields,
  overrides?: OverrideMap,
): { subject: string; html: string; text: string } | null {
  const key = templateKeyFor(kind, role, f);
  if (!key) return null;
  const def = TEMPLATE_REGISTRY[key];
  const ov = overrides?.get(key);
  const content = { subject: ov?.subject ?? def.subject, body: ov?.body ?? def.body };
  return renderTemplate(content, buildVars(role, f));
}

export interface AgendaItem {
  guestName: string;
  slotName: string | null;
  slotStartsAt: string | null;
  challenge: string | null;
  role: string | null;
  company: string | null;
}

/** One expert's day-of schedule email (aggregate — not per booking). Respects
 * a published override for `day_of_agenda__helper`, else the built-in default. */
export function renderAgenda(
  input: { firstName: string; eventName: string | null; eventDate: string | null; items: AgendaItem[] },
  overrides?: OverrideMap,
): { subject: string; html: string; text: string } {
  const def = TEMPLATE_REGISTRY.day_of_agenda__helper;
  const ov = overrides?.get("day_of_agenda__helper");
  const content = { subject: ov?.subject ?? def.subject, body: ov?.body ?? def.body };
  // One scannable block per 1:1 (blank line between → separate paragraphs), with
  // the time bolded as the anchor, then who, then the challenge.
  const agenda = input.items
    .map((it) => {
      const who = [it.role, it.company].filter(Boolean).join(", ");
      const lines = [`**${it.slotName ?? "TBD"}** — ${it.guestName}`];
      if (who) lines.push(who);
      if (it.challenge) lines.push(`Challenge: ${it.challenge}`);
      return lines.join("\n");
    })
    .join("\n\n");
  return renderTemplate(content, {
    firstName: input.firstName,
    eventName: input.eventName ?? "Notion Build Bar",
    eventDate: input.eventDate ? shortDate(input.eventDate) : "",
    agenda,
    supportEmail: SUPPORT_EMAIL,
  });
}

/** Representative sample booking for previews in the editor/gallery. */
export const SAMPLE_FIELDS: CommsFields = {
  bookingId: "preview",
  guestName: "Nancy Chen",
  guestEmail: "guest@example.com",
  company: "Notion",
  role: "Community",
  challenge: "Automating my team's roadmap in Notion",
  guestPhone: "+1 555-0100",
  slotName: "2:00–2:30 PM",
  slotStartsAt: "2026-08-28T21:00:00Z",
  slotEndsAt: "2026-08-28T21:30:00Z",
  eventName: "Notion Build Bar",
  eventDate: "2026-08-28",
  location: "New York",
  address: "123 Example St, New York, NY",
  helperName: "Alex Rivera",
  helperEmail: "alex@example.com",
  status: "assigned",
  slotId: "slot-preview",
  eventUrl: "https://lu.ma/notion-build-bar",
  conflicts: [
    { name: "Nancy Chen", role: "Community", company: "Notion", challenge: "Automating my team's roadmap" },
    { name: "Jordan Lee", role: "PM", company: "Acme", challenge: "Setting up a CRM in Notion" },
  ],
};
