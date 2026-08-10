import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sendFeedbackForEndedEvents } from "@/lib/events/expert-feedback";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Hourly. DMs each expert an interactive feedback prompt for events whose last
 * slot ended >= 2h ago. Idempotent per (event, expert): rows already created =
 * skip. Safe to fire repeatedly.
 */
export async function POST(req: Request) {
  const secret = env.app.cronSecret();
  const provided =
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { events, experts } = await sendFeedbackForEndedEvents();
  await logSync({ direction: "luma_in", result: "applied", action: "expert_feedback_cron", note: `events=${events} experts=${experts}` });
  return NextResponse.json({ events, experts });
}

export const GET = POST;
