import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sendFeedbackReminders } from "@/lib/events/expert-feedback";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Hourly. Sends a single "don't forget to give feedback" DM to each expert who was
 * prompted >= 18h ago and still gave zero feedback. Idempotent per (event, expert)
 * via expert_feedback.reminder_sent_at; a failed DM isn't marked, so it retries.
 */
export async function POST(req: Request) {
  const secret = env.app.cronSecret();
  const provided =
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const reminded = await sendFeedbackReminders();
  if (reminded > 0) {
    await logSync({ direction: "luma_in", result: "applied", action: "expert_feedback_reminder_cron", note: `experts=${reminded}` });
  }
  return NextResponse.json({ reminded });
}

// Vercel Cron issues GET by default; accept both.
export const GET = POST;
