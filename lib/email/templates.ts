export type CommsKind = "assigned" | "checked_in" | "no_show";
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
  if (kind === "assigned" && role === "helper") {
    return {
      subject: `Office Hours booking confirmed — ${f.guestName}`,
      ...wrap([
        `Hi ${f.helperName ?? "there"},`,
        "",
        "Your Office Hours booking has been confirmed.",
        "",
        ...details,
        "",
        "A calendar hold has been added for the scheduled time.",
        "",
        "Thanks,",
      ]),
    };
  }
  if (kind === "assigned" && role === "guest") {
    return {
      subject: `Your Office Hours slot is confirmed${f.eventDate ? ` — ${f.eventDate}` : ""}`,
      ...wrap([
        `Hi ${f.guestName},`,
        "",
        `Your Office Hours slot is confirmed with ${f.helperName ?? "your host"}.`,
        "",
        ...details,
        "",
        "A calendar invite is attached.",
      ]),
    };
  }
  if (kind === "checked_in" && role === "helper") {
    return {
      subject: `Guest checked in: ${f.guestName}`,
      ...wrap([
        `Hi ${f.helperName ?? "there"},`,
        "",
        "Your guest has arrived and has been marked as checked in.",
        "",
        ...details,
      ]),
    };
  }
  if (kind === "no_show" && role === "helper") {
    return {
      subject: `No-show: ${f.guestName}`,
      ...wrap([
        `Hi ${f.helperName ?? "there"},`,
        "",
        "This booking has been marked as a no-show.",
        "",
        ...details,
      ]),
    };
  }
  return null;
}
