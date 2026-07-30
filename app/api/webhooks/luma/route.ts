import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyLumaSignature } from "@/lib/luma/verify";
import { normalizeGuest } from "@/lib/luma/parse";
import type { LumaWebhookEnvelope } from "@/lib/luma/types";
import { getEventByLumaId } from "@/lib/db/events";
import { matchSlotForEvent } from "@/lib/db/slots";
import { upsertBookingFromLuma, checkInByLumaGuestId } from "@/lib/db/bookings";
import { pushBookingToWorkspaces } from "@/lib/notion/push";
import { logSync } from "@/lib/sync/log";

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

    const event = await getEventByLumaId(norm.lumaEventId);
    if (!event) {
      await logSync({
        direction: "luma_in",
        result: "error",
        action: type,
        payload: envelope as never,
        note: `no matching event for luma id ${norm.lumaEventId}`,
      });
      // 200 so Luma doesn't retry — this needs an Events row, not a redelivery.
      return NextResponse.json({ received: true, warning: "unknown event" });
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
      if (updated) booking = updated;
    }

    // Mirror to both Notion workspaces (no-op until Notion is configured).
    // TODO(scale): for high volume, enqueue this so we always 2xx within Luma's
    // 5s window; today the Notion legs are skipped until tokens are set.
    await pushBookingToWorkspaces(booking, {
      dev: { slotLabel: slot?.name ?? null, location: event.city },
      ambassador: { slotLabel: slot?.name ?? null, location: event.city },
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
