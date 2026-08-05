import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { listRetriableComms } from "@/lib/db/email-log";
import { sendBookingComms } from "@/lib/email/comms";
import type { CommsKind } from "@/lib/email/templates";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Retry transient email failures. Vercel Cron calls this on a schedule; it finds
 * every (booking, kind) with a `failed` recipient and re-invokes sendBookingComms
 * — reserveCommsSlot reclaims the failed row and re-sends only the failed ones
 * (already-`sent` recipients are left alone). Guarded by the shared cron secret.
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
  return NextResponse.json({ retried: retriable.length });
}

// Vercel Cron issues GET by default; accept both.
export const GET = POST;
