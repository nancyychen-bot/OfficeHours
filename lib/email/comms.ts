import { getBookingDetailsById } from "../db/bookings";
import { reserveCommsSlot, finalizeComms, type CommsStatus } from "../db/email-log";
import { sendEmail, type EmailAttachment } from "./resend";
import { buildInvite, buildCancel, inviteAttachment, fromAddressEmail } from "./ics";
import { renderComms, inviteDescription, type CommsFields, type CommsKind, type Recipient } from "./templates";
import { env } from "../env";
import { logSync } from "../sync/log";
import type { BookingDetails } from "../sync/types";

/** Readable message for logs — Supabase/PG errors are plain objects, not Errors. */
function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const o = err as { message?: unknown; details?: unknown; code?: unknown };
    const parts = [o.message, o.details, o.code].filter(Boolean).map(String);
    if (parts.length) return parts.join(" | ");
    try { return JSON.stringify(err); } catch { return String(err); }
  }
  return String(err);
}

/** Injectable side-effects so the orchestrator is unit-testable. */
export interface CommsDeps {
  getFields: (bookingId: string) => Promise<CommsFields | null>;
  /** Atomically claim the send slot (keyed on email); true only for the winner. */
  reserve: (bookingId: string, kind: string, role: string, email: string) => Promise<boolean>;
  /** Set the terminal status for a reserved slot (keyed on recipient email). */
  finalize: (bookingId: string, kind: string, email: string, outcome: { resendId: string | null; status: CommsStatus }) => Promise<void>;
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
    address: (d.address as string) ?? null,
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
  reserve: reserveCommsSlot,
  finalize: finalizeComms,
  send: sendEmail,
  enabled: () => env.comms.enabled(),
  from: () => env.comms.from(),
  now: () => new Date().toISOString(),
};

const RECIPIENTS: Record<CommsKind, Recipient[]> = {
  assigned: ["helper", "guest"],
  checked_in: ["helper", "guest"],
  no_show: ["helper"],
  cancelled: ["guest", "helper"],
  expert_unavailable: ["guest", "helper"],
  declined: ["guest", "helper"],
  waitlisted: ["guest", "helper"],
  event_cancelled: ["guest", "helper"],
  arrived_after_no_show: ["helper", "guest"],
  double_booked: ["helper"],
  feedback_request: ["guest"],
};

/** Kinds that tear down a booking → attach a calendar CANCEL to remove the hold. */
const CANCEL_CALENDAR_KINDS = new Set<CommsKind>([
  "cancelled",
  "declined",
  "expert_unavailable",
  "waitlisted",
  "no_show",
  "event_cancelled",
]);

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

    // Whether this kind carries a calendar file (invite on assigned; CANCEL on teardowns).
    const isCalendarKind = kind === "assigned" || CANCEL_CALENDAR_KINDS.has(kind);
    if (isCalendarKind && kind === "assigned" && !f.slotStartsAt) {
      await logSync({ direction: "luma_in", result: "applied", bookingId, action: "comms_ics_skipped", note: "no slot time" });
    }

    for (const role of RECIPIENTS[kind]) {
      const to = role === "helper" ? f.helperEmail : f.guestEmail;
      if (!to) {
        // The helper (who just claimed) is the key recipient — surface a missing
        // address rather than dropping it silently. Guests legitimately vary.
        if (role === "helper") {
          await logSync({ direction: "luma_in", result: "applied", bookingId, action: `comms_${kind}_helper_skipped`, note: "no booked_by_email" });
        }
        continue;
      }
      const rendered = renderComms(kind, role, f);
      if (!rendered) continue;

      // Per-recipient calendar file: the guest's title names their Notion expert;
      // the helper's names the guest ("Notion Build Bar - Meet …").
      let attachment: EmailAttachment | undefined;
      if (isCalendarKind) {
        const summary =
          role === "helper"
            ? `Notion Build Bar - Meet ${f.guestName}`
            : `Notion Build Bar - Meet ${f.helperName ?? "your Notion expert"}`;
        const icsFields = {
          bookingId: f.bookingId,
          guestName: f.guestName,
          guestEmail: f.guestEmail,
          helperEmail: f.helperEmail,
          helperName: f.helperName,
          slotStartsAt: f.slotStartsAt,
          slotEndsAt: f.slotEndsAt,
          // Prefer the specific street address for the calendar invite; fall back to city.
          location: f.address ?? f.location,
          descriptionText: inviteDescription(f),
          summary,
        };
        const ics =
          kind === "assigned"
            ? buildInvite(icsFields, fromAddressEmail(deps.from()), deps.now())
            : buildCancel(icsFields, fromAddressEmail(deps.from()), deps.now());
        if (ics) attachment = inviteAttachment(ics, kind === "assigned" ? "REQUEST" : "CANCEL");
      }

      // Reserve BEFORE sending so concurrent retries can't both send. A false
      // means already sent, or another run owns it, or it's mid-flight.
      if (!(await deps.reserve(bookingId, kind, role, to))) continue;

      if (!deps.enabled()) {
        // Kill-switch: record as skipped (retryable — reserve re-claims it later).
        await deps.finalize(bookingId, kind, to, { resendId: null, status: "skipped" });
        continue;
      }
      try {
        const { id } = await deps.send({
          to,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          attachments: attachment ? [attachment] : undefined,
        });
        if (!id) throw new Error("Resend returned no message id");
        await deps.finalize(bookingId, kind, to, { resendId: id, status: "sent" });
      } catch (err) {
        // Leave the row as `failed` (retryable) and surface it.
        await deps.finalize(bookingId, kind, to, { resendId: null, status: "failed" });
        await logSync({ direction: "luma_in", result: "error", bookingId, action: `comms_${kind}_${role}`, note: errText(err) });
      }
    }
  } catch (err) {
    // Never let comms break the booking sync.
    await logSync({ direction: "luma_in", result: "error", bookingId, action: `comms_${kind}`, note: errText(err) });
  }
}
