import { getBookingDetailsById, listHelperBookingsInSlot } from "../db/bookings";
import { getEventById } from "../db/events";
import { reserveCommsSlot, finalizeComms, type CommsStatus } from "../db/email-log";
import { sendEmail, type EmailAttachment } from "./resend";
import { buildInvite, buildCancel, inviteAttachment, fromAddressEmail } from "./ics";
import { renderComms, inviteDescription, type CommsFields, type CommsKind, type Recipient, type OverrideMap } from "./templates";
import { getLiveOverrideMap } from "../db/email-overrides";
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
  /** Published copy overrides (falls back to built-in defaults). Optional in tests. */
  getOverrides?: () => Promise<OverrideMap>;
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
    slotId: (d.slot_id as string) ?? null,
  };
}

const defaultDeps: CommsDeps = {
  getFields: async (id) => {
    const d = await getBookingDetailsById(id);
    if (!d) return null;
    const f = toCommsFields(d);
    try {
      const ev = d.event_id ? await getEventById(d.event_id as string) : null;
      f.eventUrl = ev?.public_url ?? null;
    } catch {
      /* best-effort — falls back to the calendar link in buildVars */
    }
    return f;
  },
  reserve: reserveCommsSlot,
  finalize: finalizeComms,
  send: sendEmail,
  enabled: () => env.comms.enabled(),
  from: () => env.comms.from(),
  now: () => new Date().toISOString(),
  getOverrides: getLiveOverrideMap,
};

const RECIPIENTS: Record<CommsKind, Recipient[]> = {
  assigned: ["helper", "guest"],
  checked_in: ["helper", "guest"],
  no_show: ["helper"],
  cancelled: ["guest", "helper"],
  expert_unavailable: ["helper"], // guest handled in the backend (re-match; day-before apology)
  rematch_pending: ["guest"],
  unmatched_notice: ["guest"],
  declined: ["guest", "helper"],
  waitlisted: ["guest", "helper"],
  event_cancelled: ["guest", "helper"],
  arrived_after_no_show: ["helper", "guest"],
  double_booked: ["helper"],
  feedback_request: ["guest"],
  prep_reminder: ["guest"],
  prep_reminder_day_before: ["guest"],
  reassigned_off: ["helper"],
  already_claimed: [], // sent directly to the would-be claimer via sendCommsToEmail
  day_of_agenda: [], // aggregate per-expert email — sent via lib/events/agenda, not here
  unclaim_denied: [], // sent directly to the would-be unclaimer via sendCommsToEmail
  slot_changed: ["helper", "guest"], // guest self-served a new slot: notify both; expert removed
};

/** Kinds that tear down a booking → attach a calendar CANCEL to remove the hold. */
const CANCEL_CALENDAR_KINDS = new Set<CommsKind>([
  "cancelled",
  "declined",
  "expert_unavailable",
  "waitlisted",
  "no_show",
  "event_cancelled",
  "reassigned_off",
  "slot_changed",
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

    // Published copy overrides (best-effort — fall back to built-in defaults).
    let overrides: OverrideMap = new Map();
    try {
      if (deps.getOverrides) overrides = await deps.getOverrides();
    } catch (err) {
      await logSync({ direction: "luma_in", result: "applied", bookingId, action: "comms_overrides_skipped", note: errText(err) });
    }

    // Double-booked email lists every guest this expert holds in the slot.
    if (kind === "double_booked" && f.slotId && f.helperEmail) {
      try {
        f.conflicts = await listHelperBookingsInSlot(f.helperEmail, f.slotId);
      } catch (err) {
        await logSync({ direction: "luma_in", result: "applied", bookingId, action: "comms_conflicts_skipped", note: errText(err) });
      }
    }

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
      const rendered = renderComms(kind, role, f, overrides);
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

/**
 * Send a booking-contextual email to an ARBITRARY address (e.g. a would-be
 * claimer who isn't the booking's guest/helper). Best-effort; deduped per
 * (booking, kind, email) like the rest.
 */
export async function sendCommsToEmail(
  bookingId: string,
  kind: CommsKind,
  role: Recipient,
  toEmail: string,
  deps: CommsDeps = defaultDeps,
): Promise<void> {
  try {
    const f = await deps.getFields(bookingId);
    if (!f) return;
    let overrides: OverrideMap = new Map();
    try {
      if (deps.getOverrides) overrides = await deps.getOverrides();
    } catch { /* fall back to defaults */ }
    const rendered = renderComms(kind, role, f, overrides);
    if (!rendered) return;
    if (!(await deps.reserve(bookingId, kind, role, toEmail))) return;
    if (!deps.enabled()) {
      await deps.finalize(bookingId, kind, toEmail, { resendId: null, status: "skipped" });
      return;
    }
    try {
      const { id } = await deps.send({ to: toEmail, subject: rendered.subject, html: rendered.html, text: rendered.text });
      if (!id) throw new Error("Resend returned no message id");
      await deps.finalize(bookingId, kind, toEmail, { resendId: id, status: "sent" });
    } catch (err) {
      await deps.finalize(bookingId, kind, toEmail, { resendId: null, status: "failed" });
      await logSync({ direction: "luma_in", result: "error", bookingId, action: `comms_${kind}_direct`, note: errText(err) });
    }
  } catch (err) {
    await logSync({ direction: "luma_in", result: "error", bookingId, action: `comms_${kind}_direct`, note: errText(err) });
  }
}
