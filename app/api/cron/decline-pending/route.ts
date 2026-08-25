import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { dispatchDeclinePendingForTomorrow } from "@/lib/events/decline-pending";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
// Popular events can leave 100+ guests pending the day before. Declining each is
// ~7 sequential network calls; at 60s the function was killed mid-sweep (never
// reaching the completion log), stranding the rest. 300s + bounded concurrency
// (see DECLINE_CONCURRENCY) lets a full sweep finish in one invocation.
export const maxDuration = 300;

/**
 * Day-before auto-decline. Vercel Cron calls this daily (ahead of the agenda /
 * prep / rematch crons); for events happening tomorrow, it declines every guest
 * still at luma_status = 'pending' — sending the declined email, writing declined
 * back to Luma (no duplicate email), and mirroring Declined to both Notion DBs.
 */
export async function POST(req: Request) {
  const secret = env.app.cronSecret();
  const provided =
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { events, guests } = await dispatchDeclinePendingForTomorrow();
  if (guests > 0) {
    await logSync({ direction: "luma_in", result: "applied", action: "decline_pending_cron", note: `events=${events} guests=${guests}` });
  }
  return NextResponse.json({ events, guests });
}

// Vercel Cron issues GET by default; accept both.
export const GET = POST;
