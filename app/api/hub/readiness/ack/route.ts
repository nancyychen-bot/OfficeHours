import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Toggle an event's "setup complete" mark on the readiness page. Operator-only.
 * Completing drops the event from the daily alert email; the page still shows its
 * live status. */
export async function POST(req: Request) {
  const secret = process.env.HUB_SESSION_SECRET;
  if (!secret || !(await isValidSession((await cookies()).get(SESSION_COOKIE)?.value, secret))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { lumaEventId?: string; done?: boolean };
  const lumaEventId = String(body.lumaEventId ?? "").trim();
  if (!lumaEventId) {
    return NextResponse.json({ ok: false, error: "lumaEventId required" }, { status: 400 });
  }
  const { error } = await getAdminClient()
    .from("events")
    .update({ readiness_acked_at: body.done ? new Date().toISOString() : null })
    .eq("luma_event_id", lumaEventId);
  if (error) {
    console.error("[readiness/ack] update failed", error);
    return NextResponse.json({ ok: false, error: "update failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, acked: !!body.done });
}
