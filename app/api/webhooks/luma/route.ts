import { NextResponse } from "next/server";
import { verifyAnyLumaSignature } from "@/lib/luma/verify";
import { lumaWebhookSecrets } from "@/lib/luma/calendars";
import { normalizeGuest } from "@/lib/luma/parse";
import type { LumaWebhookEnvelope } from "@/lib/luma/types";
import { ingestRegistration } from "@/lib/events/ingest";
import { registerEventFromLuma, NotABuildBarEventError } from "@/lib/events/register";
import { cancelEventByLumaId } from "@/lib/events/cancel-event";
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
  // Multi-calendar: accept a signature from ANY configured calendar's secret.
  // Routing to the right event is by luma_event_id (globally unique), not by which
  // secret matched — so a shared endpoint serves every calendar safely.
  const secrets = await lumaWebhookSecrets();
  const signatureHeader = req.headers.get("Webhook-Signature");

  if (secrets.length > 0) {
    const ok = verifyAnyLumaSignature({ rawBody, signatureHeader, secrets });
    if (!ok) {
      await logSync({ direction: "luma_in", result: "error", action: "verify", note: "bad signature" });
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  } else {
    // No secrets configured (bootstrap, or a DB outage made calendars fail-open to
    // an empty env keyring): the request is processed UNSIGNED. Log it as an error
    // so this is observable/queryable rather than a silent accept-unsigned.
    await logSync({ direction: "luma_in", result: "error", action: "verify", note: "no webhook secrets configured — processed unsigned" });
  }

  let envelope: LumaWebhookEnvelope;
  try {
    envelope = JSON.parse(rawBody) as LumaWebhookEnvelope;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { type, data } = envelope;

  // Whole-event cancellation: cancel every booking for the event, notify guests +
  // helpers, and remove their calendar holds.
  if (type === "event.canceled") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (data as any)?.event?.id ?? (data as any)?.id;
    const lumaEventId = typeof raw === "string" ? (raw.match(/evt-[A-Za-z0-9]+/)?.[0] ?? null) : null;
    if (!lumaEventId) {
      await logSync({ direction: "luma_in", result: "applied", action: "event.canceled", note: `no evt id in payload: ${JSON.stringify(data).slice(0, 300)}` });
      return NextResponse.json({ received: true });
    }
    try {
      const res = await cancelEventByLumaId(lumaEventId);
      await logSync({ direction: "luma_in", result: "applied", action: "event.canceled", note: res.found ? `cancelled ${res.cancelled} booking(s) for ${lumaEventId}` : `untracked event ${lumaEventId}` });
    } catch (err) {
      await logSync({ direction: "luma_in", result: "error", action: "event.canceled", note: err instanceof Error ? err.message : String(err) });
    }
    return NextResponse.json({ received: true });
  }

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
      // The event isn't in our table yet — typically a new city's event that went
      // live on Luma and collected RSVPs before it was registered in the hub. Luma
      // never resends webhooks, so dropping here silently loses every RSVP in that
      // window. The signature proved this came from a CONNECTED calendar — but
      // those calendars also host non-Build-Bar Notion events, so auto-register
      // ONLY our events (requireBuildBarName); a foreign event is skipped, not
      // imported. The auto-register path also backfills the event's full Luma guest
      // list, which ingests THIS guest too. Fall back to the prior drop-and-log if
      // it can't complete (e.g. Luma has no venue city/timezone on the event yet).
      try {
        const reg = await registerEventFromLuma({ lumaEvent: norm.lumaEventId }, { requireBuildBarName: true });
        await logSync({
          direction: "luma_in",
          result: "applied",
          action: "auto_register",
          note: `${norm.lumaEventId} (${reg.city}) auto-registered on first RSVP — imported ${reg.importedGuests} guest(s)`,
        });
        return NextResponse.json({ received: true, autoRegistered: true });
      } catch (regErr) {
        if (regErr instanceof NotABuildBarEventError) {
          // A foreign event sharing a connected calendar. Correctly NOT ours — don't
          // register, don't email, just record it. Not an error.
          await logSync({
            direction: "luma_in",
            result: "applied",
            action: "skipped_foreign_event",
            note: `${norm.lumaEventId} "${regErr.eventName}" is not a Build Bar event — skipped (guest ${norm.guestName})`,
          });
          return NextResponse.json({ received: true, skipped: true });
        }
        // Log as an ERROR with a distinct action (not result:"applied", which is
        // indistinguishable from a successful upsert) so it's visible and queryable.
        // Include the guest so a manual registration can recover it. Still 200 to
        // avoid a Luma retry-storm.
        await logSync({
          direction: "luma_in",
          result: "error",
          action: "unknown_event",
          note: `${outcome.reason} — guest ${norm.guestName} <${norm.guestEmail ?? "no email"}> — auto-register failed: ${regErr instanceof Error ? regErr.message : String(regErr)}`,
        });
        return NextResponse.json({ received: true, ignored: true });
      }
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
