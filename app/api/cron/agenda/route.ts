import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sendAgendasForToday } from "@/lib/events/agenda";
import { sendDayOfGuestForToday } from "@/lib/events/day-of-guest";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Day-of comms. Vercel Cron calls this each morning; at 9am event-local it emails
 * every expert their 1:1 lineup AND every claimed-1:1 guest their slot + expert,
 * for any event happening TODAY. Both are idempotent via email_log dedup, so it's
 * safe if the cron fires more than once.
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
  const guestRes = await sendDayOfGuestForToday();
  await logSync({
    direction: "luma_in",
    result: "applied",
    action: "agenda_cron",
    note: `events=${events} experts=${experts}; dayOfGuest events=${guestRes.events} guests=${guestRes.guests}`,
  });
  return NextResponse.json({ events, experts, dayOfGuest: guestRes });
}

// Vercel Cron issues GET by default; accept both.
export const GET = POST;
