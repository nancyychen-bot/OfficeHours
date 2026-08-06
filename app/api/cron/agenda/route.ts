import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sendAgendasForToday } from "@/lib/events/agenda";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Day-of agenda. Vercel Cron calls this each morning; it emails every expert
 * their 1:1 lineup for any event happening TODAY. Idempotent via email_log dedup,
 * so it's safe if the cron fires more than once.
 */
export async function POST(req: Request) {
  const secret = env.app.cronSecret();
  const provided =
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { events, experts } = await sendAgendasForToday();
  await logSync({
    direction: "luma_in",
    result: "applied",
    action: "agenda_cron",
    note: `events=${events} experts=${experts}`,
  });
  return NextResponse.json({ events, experts });
}

// Vercel Cron issues GET by default; accept both.
export const GET = POST;
