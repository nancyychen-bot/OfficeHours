import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { listRetriableComms } from "@/lib/db/email-log";
import { listBookingIdsNeedingAssignedComms } from "@/lib/db/bookings";
import { sendBookingComms } from "@/lib/email/comms";
import { postClaimConfirmDM } from "@/lib/slack/notify";
import { postSlackClaimed } from "@/lib/slack/client";
import type { CommsKind } from "@/lib/email/templates";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Retry transient email failures. Vercel Cron calls this on a schedule; it finds
 * every (booking, kind) with a `failed` recipient and re-invokes sendBookingComms
 * — reserveCommsSlot reclaims the failed row and re-sends only the failed ones
 * (already-`sent` recipients are left alone). Guarded by the shared cron secret.
 *
 * Also a backstop for claims that committed the DB assignment but died before
 * `sendBookingComms` (e.g. the notion webhook hit its function timeout). Those
 * have NO email_log row, so the failure-retry above can't see them — we detect
 * assigned bookings missing their `assigned` comm and re-drive the full claim
 * side-effects (email + Slack).
 */
export async function POST(req: Request) {
  const secret = env.app.cronSecret();
  const provided =
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const retriable = await listRetriableComms();
  for (const { bookingId, kind } of retriable) {
    await sendBookingComms(bookingId, kind as CommsKind);
    await logSync({ direction: "luma_in", result: "applied", bookingId, action: `comms_retry:${kind}` });
  }

  // Backstop: assigned bookings whose `assigned` comm never got a ledger row.
  const missing = await listBookingIdsNeedingAssignedComms();
  for (const bookingId of missing) {
    await sendBookingComms(bookingId, "assigned");
    await postClaimConfirmDM(bookingId);
    await postSlackClaimed(bookingId);
    await logSync({ direction: "luma_in", result: "applied", bookingId, action: "claim_comms_healed" });
  }

  return NextResponse.json({ retried: retriable.length, healed: missing.length });
}

// Vercel Cron issues GET by default; accept both.
export const GET = POST;
