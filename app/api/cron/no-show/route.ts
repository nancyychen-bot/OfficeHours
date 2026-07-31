import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { markNoShowsForStartedSlots } from "@/lib/db/bookings";
import { pushBookingToWorkspaces } from "@/lib/notion/push";
import { logSync } from "@/lib/sync/log";
import { sendBookingComms } from "@/lib/email/comms";

export const runtime = "nodejs";

/**
 * No-show sweep. Vercel Cron calls this on a schedule; it flips any booking whose
 * slot STARTED > NO_SHOW_GRACE_MINUTES ago and is not Checked In to No-show, then
 * mirrors the status to Notion + emails the helper. Guarded by a shared secret.
 */
export async function POST(req: Request) {
  const secret = env.app.cronSecret();
  const provided =
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const swept = await markNoShowsForStartedSlots(new Date());
  for (const booking of swept) {
    await pushBookingToWorkspaces(booking);
    await sendBookingComms(booking.id, "no_show");
    await logSync({ direction: "luma_in", result: "applied", bookingId: booking.id, action: "no_show" });
  }
  return NextResponse.json({ swept: swept.length });
}

// Vercel Cron issues GET by default; accept both.
export const GET = POST;
