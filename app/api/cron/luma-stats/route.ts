import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { syncAllLumaStats } from "@/lib/events/luma-stats";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Refresh authoritative per-event stats from Luma (registered/approved/checked-in/
 * waitlist) for the results dashboard. Vercel Cron calls this every 15 min.
 */
export async function POST(req: Request) {
  const secret = env.app.cronSecret();
  const provided =
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { synced, failed } = await syncAllLumaStats();
  await logSync({ direction: "luma_in", result: "applied", action: "luma_stats_cron", note: `synced=${synced} failed=${failed}` });
  return NextResponse.json({ synced, failed });
}

export const GET = POST;
