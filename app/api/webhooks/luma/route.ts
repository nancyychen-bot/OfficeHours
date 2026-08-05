import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyLumaSignature } from "@/lib/luma/verify";
import { normalizeGuest } from "@/lib/luma/parse";
import type { LumaWebhookEnvelope } from "@/lib/luma/types";
import { ingestRegistration } from "@/lib/events/ingest";
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

    // Every registrant becomes/updates a booking (no approval gate) and mirrors
    // to both Notion workspaces. Shared with the event backfill via ingest.
    const outcome = await ingestRegistration(norm, { live: true });
    if (outcome.status === "ignored") {
      await logSync({ direction: "luma_in", result: "applied", action: "ignored", note: outcome.reason });
      return NextResponse.json({ received: true, ignored: true });
    }

    await logSync({
      direction: "luma_in",
      result: "applied",
      bookingId: outcome.booking.id,
      action: type,
      note: outcome.checkedIn ? "upserted + checked_in" : "upserted",
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
