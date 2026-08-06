export type CommsKind = "assigned" | "checked_in" | "no_show" | "cancelled" | "expert_unavailable" | "declined" | "waitlisted" | "event_cancelled";
export type Recipient = "helper" | "guest";

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
}

/** The shared "Guest details" block (agent spec), omitting absent optionals. */
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

/** First name for a warm greeting; falls back to "there" for missing names. */
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

/**
 * Clean, guest-facing calendar-invite body (the .ics DESCRIPTION) — NOT the
 * internal details dump. Confirmation + slot, address, expert, and an arrival nudge.
 */
export function inviteDescription(f: CommsFields): string {
  const place = f.address ?? f.location;
  const lines = ["You're confirmed for your Notion Build Bar 1:1! Details:", ""];
  if (f.slotName) lines.push(`Time slot: ${f.slotName}`);
  if (place) lines.push(`Location: ${place}`);
  if (f.helperName) lines.push(`Your Notion expert: ${f.helperName}`);
  lines.push("");
  lines.push("Please arrive 5 minutes before the start of your booking.");
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wrap(bodyLines: string[]): { html: string; text: string } {
  const text = bodyLines.join("\n");
  const html = bodyLines
    .map((l) => (l === "" ? "<br/>" : `<p style="margin:0 0 8px">${escapeHtml(l)}</p>`))
    .join("");
  return { html, text };
}

/** Render subject + html + text for a kind×recipient, or null if none applies. */
export function renderComms(
  kind: CommsKind,
  role: Recipient,
  f: CommsFields,
): { subject: string; html: string; text: string } | null {
  const details = guestDetailsLines(f);
  const session = guestSessionLines(f);
  const SIGNOFF = "The Notion Community Team";
  const SUPPORT = "If you have any questions please email communityevents@makenotion.com";

  if (kind === "assigned" && role === "helper") {
    return {
      subject: `You're helping ${f.guestName} at Notion Build Bar`,
      ...wrap([
        `Hi ${firstName(f.helperName)},`,
        "",
        "Thanks for jumping in! You've claimed a 1:1 at Notion Build Bar — here's who you'll be helping:",
        "",
        ...details,
        "",
        "📅 A calendar hold is attached for the scheduled time.",
        "",
        "Come ready to help them leave with something that actually works. If anything changes, unclaim the card and we'll find them a new match.",
        "",
        "Thanks for building with us,",
        SIGNOFF,
      ]),
    };
  }
  if (kind === "assigned" && role === "guest") {
    return {
      subject: `📅 Invitation: your Notion Build Bar 1:1${f.eventDate ? ` — ${shortDate(f.eventDate)}` : ""}`,
      ...wrap([
        `Hi ${firstName(f.guestName)},`,
        "",
        `Great news — your 1:1 at Notion Build Bar is confirmed${f.helperName ? `, and ${f.helperName} will be your Notion expert` : ""}. We can't wait to build with you!`,
        "",
        "Here's your session:",
        ...session,
        "",
        "📅 A calendar invite is attached so the time is locked in.",
        "",
        "Can't make it? Please cancel your registration to free up the spot for someone else.",
        "",
        SUPPORT,
        "",
        "See you soon,",
        SIGNOFF,
      ]),
    };
  }
  if (kind === "checked_in" && role === "helper") {
    return {
      subject: `${f.guestName} just checked in`,
      ...wrap([
        `Hi ${firstName(f.helperName)},`,
        "",
        `Your guest ${f.guestName} has arrived and is checked in. A quick refresher before you meet:`,
        "",
        ...details,
        "",
        "Head over whenever you're ready. Thanks for building with us,",
        SIGNOFF,
      ]),
    };
  }
  if (kind === "checked_in" && role === "guest") {
    return {
      subject: "You're checked in — welcome to Build Bar 👋",
      ...wrap([
        `Hi ${firstName(f.guestName)},`,
        "",
        `You're all checked in — welcome to Notion Build Bar! ${f.helperName ? `${f.helperName} will be with you shortly.` : "Feel free to cowork, grab a coffee and a snack."}`,
        "",
        "Grab a seat, open your workspace, and get ready to build. If you need anything, just flag someone on the Community team.",
        "",
        SUPPORT,
        "",
        "See you inside,",
        SIGNOFF,
      ]),
    };
  }
  if (kind === "no_show" && role === "helper") {
    return {
      subject: `No-show: ${f.guestName}`,
      ...wrap([
        `Hi ${firstName(f.helperName)},`,
        "",
        `Heads up — ${f.guestName} didn't check in for their slot, so we've marked it as a no-show. Nothing you need to do; the slot has been freed up.`,
        "",
        ...details,
        "",
        "Thanks for being here,",
        SIGNOFF,
      ]),
    };
  }
  if (kind === "cancelled" && role === "guest") {
    return {
      subject: "Your Notion Build Bar 1:1 was cancelled",
      ...wrap([
        `Hi ${firstName(f.guestName)},`,
        "",
        "Your 1:1 at Notion Build Bar has been cancelled. If this was a surprise — or you'd like to grab another time — just email communityevents@makenotion.com.",
        "",
        "You're still very welcome to come cowork with us. The door's open.",
        "",
        "Thanks,",
        SIGNOFF,
      ]),
    };
  }
  if (kind === "cancelled" && role === "helper") {
    return {
      subject: `Slot freed — ${f.guestName}'s 1:1 was cancelled`,
      ...wrap([
        `Hi ${firstName(f.helperName)},`,
        "",
        `Quick update: the 1:1 you'd claimed with ${f.guestName} has been cancelled, so the slot has been released. Nothing you need to do.`,
        "",
        "Thanks for building with us,",
        SIGNOFF,
      ]),
    };
  }
  if (kind === "event_cancelled" && role === "guest") {
    return {
      subject: "Notion Build Bar has been cancelled",
      ...wrap([
        `Hi ${firstName(f.guestName)},`,
        "",
        "We're really sorry — Notion Build Bar has been cancelled, so your booking won't go ahead. We sincerely apologize for the disappointment.",
        "",
        "We'd still love to build with you — please follow our Notion calendar for upcoming events:",
        "",
        "👉 https://luma.com/calendar/cal-ZDQrtBgbNzSJZkh",
        "",
        SUPPORT,
        "",
        "With gratitude,",
        SIGNOFF,
      ]),
    };
  }
  if (kind === "event_cancelled" && role === "helper") {
    return {
      subject: `Event cancelled — ${f.guestName}'s 1:1 is off`,
      ...wrap([
        `Hi ${firstName(f.helperName)},`,
        "",
        `Notion Build Bar has been cancelled, so your 1:1 with ${f.guestName} won't happen. The calendar hold has been removed — nothing you need to do.`,
        "",
        "Thanks for building with us,",
        SIGNOFF,
      ]),
    };
  }
  if (kind === "waitlisted" && role === "guest") {
    return {
      subject: "You're on the waitlist for Notion Build Bar",
      ...wrap([
        `Hi ${firstName(f.guestName)},`,
        "",
        "Thanks for your interest in Notion Build Bar! We're currently at capacity, so you're on the waitlist for now. If a spot opens up, we'll email you right away.",
        "",
        "You're also welcome to follow our Notion calendar for future events:",
        "",
        "👉 https://luma.com/calendar/cal-ZDQrtBgbNzSJZkh",
        "",
        SUPPORT,
        "",
        "With gratitude,",
        SIGNOFF,
      ]),
    };
  }
  if (kind === "waitlisted" && role === "helper") {
    return {
      subject: `Slot freed — ${f.guestName} moved to the waitlist`,
      ...wrap([
        `Hi ${firstName(f.helperName)},`,
        "",
        `Quick update: ${f.guestName} has been moved to the waitlist, so the slot you'd claimed has been released. Nothing you need to do.`,
        "",
        "Thanks for building with us,",
        SIGNOFF,
      ]),
    };
  }
  if (kind === "declined" && role === "guest") {
    return {
      subject: "An update on your Notion Build Bar booking",
      ...wrap([
        `Hi ${firstName(f.guestName)},`,
        "",
        "Thank you so much for your interest in Notion Build Bar! Unfortunately, we've reached capacity for this event and aren't able to accommodate your booking this time.",
        "",
        "We're genuinely sorry to miss you — please follow our Notion calendar for future events. We'd love to build with you at the next one:",
        "",
        "👉 https://luma.com/calendar/cal-ZDQrtBgbNzSJZkh",
        "",
        SUPPORT,
        "",
        "With gratitude,",
        SIGNOFF,
      ]),
    };
  }
  if (kind === "declined" && role === "helper") {
    return {
      subject: `Slot freed — ${f.guestName} won't be joining`,
      ...wrap([
        `Hi ${firstName(f.helperName)},`,
        "",
        `Quick update: ${f.guestName}'s 1:1 has been cancelled (we're at capacity and they won't be joining), so the slot you'd claimed has been released. Nothing you need to do.`,
        "",
        "Thanks for building with us,",
        SIGNOFF,
      ]),
    };
  }
  if (kind === "expert_unavailable" && role === "helper") {
    return {
      subject: `You've released ${f.guestName}'s 1:1`,
      ...wrap([
        `Hi ${firstName(f.helperName)},`,
        "",
        `You've unclaimed ${f.guestName}'s 1:1, so it's back in the queue for another Notion expert. The calendar hold has been removed from your calendar — nothing else to do.`,
        "",
        "Thanks for building with us,",
        SIGNOFF,
      ]),
    };
  }
  if (kind === "expert_unavailable" && role === "guest") {
    return {
      subject: "A quick update on your Build Bar 1:1",
      ...wrap([
        `Hi ${firstName(f.guestName)},`,
        "",
        "Quick heads-up: the Notion expert assigned to your 1:1 is no longer available. We're already lining up a replacement and will confirm your new match shortly — your slot is still held for you.",
        "",
        "Thanks for rolling with us, and sorry for the shuffle.",
        "",
        SUPPORT,
        "",
        "See you soon,",
        SIGNOFF,
      ]),
    };
  }
  return null;
}
