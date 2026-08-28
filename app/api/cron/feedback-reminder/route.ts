import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { dispatchFeedbackRemindersForDueEvents } from "@/lib/events/feedback";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Post-event feedback reminder. Vercel Cron calls this hourly; at 9am event-local
 * on (event_date + 2), it emails every checked-in guest who hasn't submitted
 * feedback the reminder (once — guarded by events.feedback_reminder_sent_at).
 * Idempotent per recipient via email_log.
 */
export async function POST(req: Request) {
  const secret = env.app.cronSecret();
  const provided =
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { events, guests } = await dispatchFeedbackRemindersForDueEvents();
  if (events > 0) {
    await logSync({
      direction: "luma_in",
      result: "applied",
      action: "feedback_reminder_cron",
      note: `events=${events} guests=${guests}`,
    });
  }
  return NextResponse.json({ events, guests });
}

// Vercel Cron issues GET by default; accept both.
export const GET = POST;
