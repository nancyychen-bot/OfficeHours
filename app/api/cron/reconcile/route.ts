import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { reconcileCards } from "@/lib/events/reconcile-cards";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 120; // re-pushes every recent/upcoming booking to both workspaces

/**
 * Auto-heal Notion drift. Vercel Cron calls this hourly; it re-pushes every
 * recent/upcoming booking from Supabase to both cards, correcting any manual
 * edits to guest-info fields. Safe to run often (echoes are dropped by the hash).
 */
export async function POST(req: Request) {
  const secret = env.app.cronSecret();
  const provided =
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const r = await reconcileCards();
  await logSync({
    direction: "luma_in",
    result: "applied",
    action: "reconcile_cron",
    note: `bookings=${r.bookings} recreated=${r.recreated} updated=${r.updated}`,
  });
  return NextResponse.json(r);
}

export const GET = POST;
