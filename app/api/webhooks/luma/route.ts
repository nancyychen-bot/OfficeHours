import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyLumaSignature } from "@/lib/luma/verify";
import { normalizeGuest } from "@/lib/luma/parse";
import type { LumaWebhookEnvelope } from "@/lib/luma/types";
import { getEventByLumaId } from "@/lib/db/events";
import { matchSlotForEvent } from "@/lib/db/slots";
import { upsertBookingFromLuma, checkInByLumaGuestId, getBookingByLumaGuestId, cancelBooking } from "@/lib/db/bookings";
import { pushBookingToWorkspaces } from "@/lib/notion/push";
import { logSync } from "@/lib/sync/log";
import { lifecycleAction } from "@/lib/events/lifecycle";
import { approvalStatusToLumaStatus } from "@/lib/luma/approval";
import { sendBookingComms } from "@/lib/email/comms";

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
      const cancelled = (await cancelBooking(existing.id)) ?? existing;
      // Set Status → Cancelled on both cards (assignee kept) so a Notion agent
      // can notify the helper; the card drops out of open-slot views. Email is
      // handled entirely in Notion.
      await pushBookingToWorkspaces(cancelled);
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
      await logSync({ direction: "luma_in", result: "applied", action: "ignored", note: `not a registered Notion Build Bar event (${norm.lumaEventId})` });
      return NextResponse.json({ received: true, ignored: true });
    }

    const slot = norm.requestedSlot
      ? await matchSlotForEvent({ eventId: event.id, requestedLabel: norm.requestedSlot })
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
      notionEmail: norm.notionEmail,
      notionPlan: norm.notionPlan,
      experienceLevel: norm.experienceLevel,
      attendReasons: norm.attendReasons,
      requestedSlot: norm.requestedSlot,
      lumaStatus: approvalStatusToLumaStatus(norm.approvalStatus),
    });

    // Check-in transition → flip status; the helper is notified in Notion (a
    // Status → Checked In automation/agent), not by the hub.
    if (norm.isCheckedIn && booking.status !== "checked_in") {
      const updated = await checkInByLumaGuestId(norm.lumaGuestId);
      if (updated) {
        booking = updated;
        await sendBookingComms(updated.id, "checked_in");
      }
    }

    // Mirror to both Notion workspaces (no-op until Notion is configured).
    // TODO(scale): for high volume, enqueue this so we always 2xx within Luma's
    // 5s window; today the Notion legs are skipped until tokens are set.
    // fullUpdate: refresh all guest fields on the cards so re-registration edits
    // (changed challenge, slot, company, …) reflect in Notion, not just Supabase.
    await pushBookingToWorkspaces(booking, {
      fullUpdate: true,
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
