import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { dispatchRematchForTomorrow } from "@/lib/events/rematch";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Day-before apology to still-unmatched 1:1 guests. Vercel Cron calls this daily;
 * for events happening tomorrow, it emails guests who requested a 1:1 but have no
 * expert (once — email_log dedup). Guest sees nothing at unclaim time; this is the
 * fallback only if the backend couldn't re-match them.
 */
export async function POST(req: Request) {
  const secret = env.app.cronSecret();
  const provided =
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { events, guests } = await dispatchRematchForTomorrow();
  if (guests > 0) {
    await logSync({ direction: "luma_in", result: "applied", action: "rematch_apology_cron", note: `events=${events} guests=${guests}` });
  }
  return NextResponse.json({ events, guests });
}

export const GET = POST;
