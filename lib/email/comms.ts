import { getBookingDetailsById } from "../db/bookings";
import { hasSentComms, recordComms, type CommsStatus } from "../db/email-log";
import { sendEmail, type EmailAttachment } from "./resend";
import { buildInvite, inviteAttachment, fromAddressEmail } from "./ics";
import { renderComms, guestDetailsLines, type CommsFields, type CommsKind, type Recipient } from "./templates";
import { env } from "../env";
import { logSync } from "../sync/log";
import type { BookingDetails } from "../sync/types";

/** Injectable side-effects so the orchestrator is unit-testable. */
export interface CommsDeps {
  getFields: (bookingId: string) => Promise<CommsFields | null>;
  hasSent: (bookingId: string, kind: string, role: string) => Promise<boolean>;
  record: (row: { bookingId: string; eventKind: string; role: string; email: string; resendId: string | null; status: CommsStatus }) => Promise<void>;
  send: (input: { to: string; subject: string; html: string; text: string; attachments?: EmailAttachment[] }) => Promise<{ id: string }>;
  enabled: () => boolean;
  from: () => string;
  now: () => string;
}

/** Map an enriched booking_details row to the template's CommsFields. */
export function toCommsFields(d: BookingDetails): CommsFields {
  return {
    bookingId: d.id as string,
    guestName: (d.guest_name as string) ?? "",
    guestEmail: (d.guest_email as string) ?? null,
    company: (d.company as string) ?? null,
    role: (d.role as string) ?? null,
    challenge: (d.challenge as string) ?? null,
    guestPhone: (d.guest_phone as string) ?? null,
    slotName: (d.slot_name as string) ?? null,
    slotStartsAt: (d.slot_starts_at as string) ?? null,
    slotEndsAt: (d.slot_ends_at as string) ?? null,
    eventName: (d.event_name as string) ?? null,
    eventDate: (d.event_date as string) ?? null,
    location: (d.location as string) ?? null,
    helperName: (d.booked_by_display_name as string) ?? null,
    helperEmail: (d.booked_by_email as string) ?? null,
    status: d.status as string,
  };
}

const defaultDeps: CommsDeps = {
  getFields: async (id) => {
    const d = await getBookingDetailsById(id);
    return d ? toCommsFields(d) : null;
  },
  hasSent: hasSentComms,
  record: recordComms,
  send: sendEmail,
  enabled: () => env.comms.enabled(),
  from: () => env.comms.from(),
  now: () => new Date().toISOString(),
};

const RECIPIENTS: Record<CommsKind, Recipient[]> = {
  assigned: ["helper", "guest"],
  checked_in: ["helper"],
  no_show: ["helper"],
};

/**
 * Send the comms for a booking reaching `kind`. Best-effort: never throws.
 * Idempotent via email_log. On `assigned`, attaches an .ics invite (both
 * recipients are attendees) unless the slot time can't be parsed.
 */
export async function sendBookingComms(
  bookingId: string,
  kind: CommsKind,
  deps: CommsDeps = defaultDeps,
): Promise<void> {
  try {
    const f = await deps.getFields(bookingId);
    if (!f) return;

    // Build the invite once (assigned only); skip + log if the time is unparseable.
    let attachment: EmailAttachment | undefined;
    if (kind === "assigned") {
      const ics = buildInvite(
        {
          bookingId: f.bookingId,
          guestName: f.guestName,
          guestEmail: f.guestEmail,
          helperEmail: f.helperEmail,
          helperName: f.helperName,
          slotStartsAt: f.slotStartsAt,
          slotEndsAt: f.slotEndsAt,
          location: f.location,
          descriptionText: guestDetailsLines(f).join("\n"),
        },
        fromAddressEmail(deps.from()),
        deps.now(),
      );
      if (ics) attachment = inviteAttachment(ics);
      else await logSync({ direction: "luma_in", result: "applied", bookingId, action: "comms_ics_skipped", note: "unparseable slot time" });
    }

    for (const role of RECIPIENTS[kind]) {
      const to = role === "helper" ? f.helperEmail : f.guestEmail;
      if (!to) continue; // no address for this recipient → skip silently
      const rendered = renderComms(kind, role, f);
      if (!rendered) continue;
      if (await deps.hasSent(bookingId, kind, role)) continue;

      if (!deps.enabled()) {
        await deps.record({ bookingId, eventKind: kind, role, email: to, resendId: null, status: "skipped" });
        continue;
      }
      try {
        const { id } = await deps.send({
          to,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          attachments: kind === "assigned" && attachment ? [attachment] : undefined,
        });
        await deps.record({ bookingId, eventKind: kind, role, email: to, resendId: id, status: "sent" });
      } catch (err) {
        await deps.record({ bookingId, eventKind: kind, role, email: to, resendId: null, status: "failed" });
        await logSync({ direction: "luma_in", result: "error", bookingId, action: `comms_${kind}_${role}`, note: err instanceof Error ? err.message : String(err) });
      }
    }
  } catch (err) {
    // Never let comms break the booking sync.
    await logSync({ direction: "luma_in", result: "error", bookingId, action: `comms_${kind}`, note: err instanceof Error ? err.message : String(err) });
  }
}
