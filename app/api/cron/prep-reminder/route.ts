import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sendPrepForLeadWindow, sendPrepDayBeforeForLeadWindow, sendPrepDayBeforePaidForLeadWindow, PREP_LEAD_DAYS } from "@/lib/events/prep";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Pre-event prep email (T-3 days). Vercel Cron calls this daily; it emails every
 * eligible guest of any event happening exactly PREP_LEAD_DAYS from now, telling
 * them to activate Notion AI before they arrive. Idempotent via email_log dedup,
 * so it's safe if the cron fires more than once on the target day.
 */
export async function POST(req: Request) {
  const secret = env.app.cronSecret();
  const provided =
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const prep = await sendPrepForLeadWindow();
  const dayBefore = await sendPrepDayBeforeForLeadWindow();
  const dayBeforePaid = await sendPrepDayBeforePaidForLeadWindow();
  await logSync({
    direction: "luma_in",
    result: "applied",
    action: "prep_reminder_cron",
    note: `lead=${PREP_LEAD_DAYS}d events=${prep.events} guests=${prep.guests}; dayBefore events=${dayBefore.events} guests=${dayBefore.guests}; dayBeforePaid events=${dayBeforePaid.events} guests=${dayBeforePaid.guests}`,
  });
  return NextResponse.json({ prep, dayBefore, dayBeforePaid });
}

// Vercel Cron issues GET by default; accept both.
export const GET = POST;
