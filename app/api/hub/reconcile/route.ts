import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { reconcileCards } from "@/lib/events/reconcile-cards";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";
export const maxDuration = 120;

async function authed(): Promise<boolean> {
  const secret = process.env.HUB_SESSION_SECRET;
  if (!secret) return false;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSession(token, secret);
}

/** Manual "re-sync Notion from source" — re-pushes all recent/upcoming cards. */
export async function POST() {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const r = await reconcileCards();
    await logSync({ direction: "luma_in", result: "applied", action: "reconcile_manual", note: `bookings=${r.bookings} recreated=${r.recreated} updated=${r.updated}` });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
