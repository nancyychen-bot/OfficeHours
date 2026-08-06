import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { dispatchFeedbackForEndedEvents } from "@/lib/events/feedback";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Post-event feedback dispatch. Vercel Cron calls this every minute; the moment
 * an event's last slot has ended, it emails every checked-in guest the feedback
 * request (once — guarded by events.feedback_sent_at). Idempotent.
 */
export async function POST(req: Request) {
  const secret = env.app.cronSecret();
  const provided =
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { events, guests } = await dispatchFeedbackForEndedEvents();
  if (events > 0) {
    await logSync({
      direction: "luma_in",
      result: "applied",
      action: "feedback_cron",
      note: `events=${events} guests=${guests}`,
    });
  }
  return NextResponse.json({ events, guests });
}

// Vercel Cron issues GET by default; accept both.
export const GET = POST;
