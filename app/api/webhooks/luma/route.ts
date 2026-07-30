import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyLumaSignature } from "@/lib/luma/verify";
import { normalizeGuest } from "@/lib/luma/parse";
import type { LumaWebhookEnvelope } from "@/lib/luma/types";
import { getEventByLumaId } from "@/lib/db/events";
import { matchSlotForEvent, getSlotById } from "@/lib/db/slots";
import { upsertBookingFromLuma, checkInByLumaGuestId, getBookingByLumaGuestId, cancelBooking } from "@/lib/db/bookings";
import { pushBookingToWorkspaces, archiveBookingPages } from "@/lib/notion/push";
import { logSync } from "@/lib/sync/log";
import { lifecycleAction } from "@/lib/events/lifecycle";
import { sendEmail } from "@/lib/email/resend";
import { checkInEmail, cancellationEmail } from "@/lib/email/templates";

export const runtime = "nodejs";

/**
 * Luma → hub webhook (PRD §7.3 / §8.1 / §9). Handles `guest.registered` and
 * `guest.updated` (Luma has no dedicated check-in event — check-in arrives as a
 * per-ticket `checked_in_at` on `guest.updated`; see docs/research/luma-api.md).
 *
 * Idempotent: keyed on the stable Luma guest id (`gst-…`) via an upsert, so
 * Luma's at-least-once delivery / retries can't create duplicates.
 */
export async function POST(req: Request) {
  // Must read the RAW body BEFORE parsing — signature is over `{t}.{rawBody}`.
  const rawBody = await req.text();
  const secret = env.luma.webhookSecret();
  const signatureHeader = req.headers.get("Webhook-Signature");

  if (secret) {
    const ok = verifyLumaSignature({ rawBody, signatureHeader, secret });
    if (!ok) {
      await logSync({ direction: "luma_in", result: "error", action: "verify", note: "bad signature" });
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  let envelope: LumaWebhookEnvelope;
  try {
    envelope = JSON.parse(rawBody) as LumaWebhookEnvelope;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { type, data } = envelope;
  if (type !== "guest.registered" && type !== "guest.updated") {
    await logSync({ direction: "luma_in", result: "applied", action: type, note: "ignored (not a guest event)" });
    return NextResponse.json({ received: true });
  }

  try {
    const norm = normalizeGuest(data);

    const action = lifecycleAction(norm.approvalStatus);

    // CANCEL — an approved booking was declined / the guest cancelled.
    if (action === "cancel") {
      const existing = await getBookingByLumaGuestId(norm.lumaGuestId);
      if (!existing) {
        await logSync({ direction: "luma_in", result: "applied", action: "ignored", note: "decline for unknown/never-approved guest" });
        return NextResponse.json({ received: true, ignored: true });
      }
      if (existing.booked_by_email) {
        const slot = existing.slot_id ? await getSlotById(existing.slot_id) : null;
        try {
          const msg = cancellationEmail({ guestName: existing.guest_name, slotLabel: slot?.name ?? null });
          await sendEmail({ to: existing.booked_by_email, subject: msg.subject, text: msg.text });
        } catch (err) {
          await logSync({ direction: "luma_in", result: "error", bookingId: existing.id, action: "cancel_email", note: err instanceof Error ? err.message : String(err) });
        }
      }
      const cancelled = (await cancelBooking(existing.id)) ?? existing;
      await archiveBookingPages(cancelled);
      await logSync({ direction: "luma_in", result: "applied", bookingId: cancelled.id, action: "cancelled" });
      return NextResponse.json({ received: true, cancelled: true });
    }

    // IGNORE — pending / waitlist / invited: never reaches the shared DB.
    if (action === "ignore") {
      await logSync({ direction: "luma_in", result: "applied", action: "ignored", note: `not approved (${norm.approvalStatus ?? "none"})` });
      return NextResponse.json({ received: true, ignored: true });
    }

    // CREATE — approved guest becomes/updates a booking.
    const event = await getEventByLumaId(norm.lumaEventId);
    if (!event) {
      await logSync({ direction: "luma_in", result: "applied", action: "ignored", note: `not a registered Office Hours event (${norm.lumaEventId})` });
      return NextResponse.json({ received: true, ignored: true });
    }

    const slot = norm.requestedSlotLabel
      ? await matchSlotForEvent({ eventId: event.id, requestedLabel: norm.requestedSlotLabel })
      : null;

    let booking = await upsertBookingFromLuma({
      lumaGuestId: norm.lumaGuestId,
      eventId: event.id,
      slotId: slot?.id ?? null,
      guestName: norm.guestName,
      guestEmail: norm.guestEmail,
      guestPhone: norm.guestPhone,
      role: norm.role,
      company: norm.company,
      challenge: norm.challenge,
    });

    if (norm.isCheckedIn && booking.status !== "checked_in") {
      const updated = await checkInByLumaGuestId(norm.lumaGuestId);
      if (updated) {
        booking = updated;
        if (booking.booked_by_email) {
          try {
            // A check-in payload may omit registration answers, so `slot` can be
            // null here — fall back to the slot persisted on the booking.
            const slotLabel =
              slot?.name ??
              (booking.slot_id ? (await getSlotById(booking.slot_id))?.name ?? null : null);
            const msg = checkInEmail({
              guestName: booking.guest_name,
              company: booking.company,
              slotLabel,
              challenge: booking.challenge,
            });
            await sendEmail({ to: booking.booked_by_email, subject: msg.subject, text: msg.text });
          } catch (err) {
            await logSync({ direction: "luma_in", result: "error", bookingId: booking.id, action: "checkin_email", note: err instanceof Error ? err.message : String(err) });
          }
        }
      }
    }

    // Mirror to both Notion workspaces (no-op until Notion is configured).
    // TODO(scale): for high volume, enqueue this so we always 2xx within Luma's
    // 5s window; today the Notion legs are skipped until tokens are set.
    await pushBookingToWorkspaces(booking, {
      dev: { slotLabel: slot?.name ?? null, location: event.city, eventName: event.name, eventDate: event.event_date },
      ambassador: { slotLabel: slot?.name ?? null, location: event.city, eventName: event.name, eventDate: event.event_date },
    });

    await logSync({
      direction: "luma_in",
      result: "applied",
      bookingId: booking.id,
      action: type,
      note: norm.isCheckedIn ? "upserted + checked_in" : "upserted",
    });
    return NextResponse.json({ received: true });
  } catch (err) {
    await logSync({
      direction: "luma_in",
      result: "error",
      action: type,
      note: err instanceof Error ? err.message : String(err),
    });
    // 200 to avoid a retry-storm on a persistent bug; the error is captured.
    return NextResponse.json({ received: true, error: "processing failed" });
  }
}
