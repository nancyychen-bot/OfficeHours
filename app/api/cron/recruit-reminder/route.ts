import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { listRecruitReminderCandidates } from "@/lib/db/bookings";
import { selectDueRecruitReminders } from "@/lib/events/recruit-reminder";
import { markRecruitReminderSent } from "@/lib/db/slack";
import { postSlackRecruitReminder } from "@/lib/slack/client";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Re-post still-unclaimed recruit slots. Vercel Cron calls this daily; it finds
 * recruited bookings that are still open (marker set, unassigned, approved, event
 * not passed) and posts a reminder ~3 days after the first post and again 2 days
 * before the event — at most one post per booking per day. Guarded by the shared
 * cron secret.
 */
export async function POST(req: Request) {
  const secret = env.app.cronSecret();
  const provided =
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const candidates = await listRecruitReminderCandidates();
  const due = selectDueRecruitReminders(candidates, Date.now());
  for (const { id, stages } of due) {
    // Only mark the stage sent if the Slack post actually succeeded — otherwise
    // leave it due so the next run retries, rather than silently dropping it.
    const posted = await postSlackRecruitReminder(id);
    if (!posted) {
      await logSync({ direction: "luma_in", result: "error", bookingId: id, action: `slack_recruit_reminder_unsent:${stages.join("+")}`, note: "post failed; not marked" });
      continue;
    }
    await markRecruitReminderSent(id, stages, new Date().toISOString());
    await logSync({ direction: "luma_in", result: "applied", bookingId: id, action: `slack_recruit_reminder:${stages.join("+")}` });
  }
  return NextResponse.json({ reminded: due.length });
}

// Vercel Cron issues GET by default; accept both.
export const GET = POST;
