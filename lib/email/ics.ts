export interface IcsFields {
  bookingId: string;
  guestName: string;
  guestEmail: string | null;
  helperEmail: string | null;
  helperName: string | null;
  slotStartsAt: string | null;
  slotEndsAt: string | null;
  location: string | null;
  descriptionText: string;
  /** Calendar event title; defaults to "Notion Build Bar — {guest}" if unset. */
  summary?: string;
}

/** Extract the bare email from a "Name <email>" (or plain email) string. */
export function fromAddressEmail(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

function stamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

// RFC 5545 TEXT escaping.
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/**
 * Build a VEVENT for the slot. `variant` = "request" publishes the slot as an
 * add-to-calendar event (METHOD:PUBLISH, no RSVP) so accepting never emails the
 * organizer — the noreply From address isn't a real mailbox and would 550-bounce
 * the RSVP. "cancel" removes it — same UID, higher SEQUENCE, METHOD:CANCEL +
 * STATUS:CANCELLED — which calendar clients match by UID and delete. Returns null
 * if the start time is missing/unparseable. DTEND defaults to start + 30 min.
 */
function buildEvent(
  f: IcsFields,
  fromEmail: string,
  stampISO: string,
  variant: "request" | "cancel",
): string | null {
  if (!f.slotStartsAt) return null;
  const start = new Date(f.slotStartsAt);
  if (Number.isNaN(start.getTime())) return null;
  const endDate =
    f.slotEndsAt && !Number.isNaN(new Date(f.slotEndsAt).getTime())
      ? new Date(f.slotEndsAt)
      : new Date(start.getTime() + 30 * 60_000);
  const cancel = variant === "cancel";
  // Monotonic SEQUENCE from the stamp time so invite → cancel → re-invite (on a
  // re-claim) always increases; calendar clients ignore a lower/equal sequence.
  const seq = Math.max(0, Math.floor(new Date(stampISO).getTime() / 1000));

  const lines: (string | null)[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Notion Build Bar Hub//EN",
    "CALSCALE:GREGORIAN",
    cancel ? "METHOD:CANCEL" : "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:booking-${f.bookingId}@notionbuildbar`,
    `SEQUENCE:${seq}`,
    `DTSTAMP:${stamp(stampISO)}`,
    `DTSTART:${stamp(start.toISOString())}`,
    `DTEND:${stamp(endDate.toISOString())}`,
    `SUMMARY:${esc(f.summary ?? `Notion Build Bar — ${f.guestName}`)}`,
    f.location ? `LOCATION:${esc(f.location)}` : null,
    `DESCRIPTION:${esc(f.descriptionText)}`,
    `ORGANIZER;CN=Notion Build Bar:mailto:${fromEmail}`,
    // No RSVP=TRUE: with METHOD:PUBLISH this is an add-to-calendar event, not an
    // invitation, so clients don't send an RSVP reply to the (noreply) organizer.
    f.helperEmail
      ? `ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=FALSE;CN=${esc(f.helperName ?? "Helper")}:mailto:${f.helperEmail}`
      : null,
    f.guestEmail
      ? `ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=FALSE;CN=${esc(f.guestName)}:mailto:${f.guestEmail}`
      : null,
    cancel ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.filter((l): l is string => l !== null).join("\r\n");
}

/** METHOD:PUBLISH add-to-calendar event that holds the slot (no RSVP — see buildEvent). */
export function buildInvite(f: IcsFields, fromEmail: string, stampISO: string): string | null {
  return buildEvent(f, fromEmail, stampISO, "request");
}

/** METHOD:CANCEL for the same booking — removes the held slot from calendars. */
export function buildCancel(f: IcsFields, fromEmail: string, stampISO: string): string | null {
  return buildEvent(f, fromEmail, stampISO, "cancel");
}

/**
 * Wrap ICS text as an email attachment. The content-type MUST carry the METHOD
 * (PUBLISH/CANCEL) and match the VCALENDAR body's METHOD so mail clients render
 * a real Add-to-Calendar / cancel rather than a generic file.
 */
export function inviteAttachment(
  ics: string,
  method: "PUBLISH" | "CANCEL" = "PUBLISH",
): { filename: string; content: Buffer; contentType: string } {
  return {
    filename: method === "CANCEL" ? "cancel.ics" : "invite.ics",
    content: Buffer.from(ics, "utf8"),
    contentType: `text/calendar; method=${method}; charset=utf-8`,
  };
}
