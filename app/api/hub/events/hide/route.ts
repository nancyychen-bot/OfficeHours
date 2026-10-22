import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Archive (hide) or un-archive an event's dashboard. Operator-only. Hiding removes
 * it from every dashboard + the public embed and makes it inert in the crons; the
 * data is retained and the action is reversible. */
export async function POST(req: Request) {
  const secret = process.env.HUB_SESSION_SECRET;
  if (!secret || !(await isValidSession((await cookies()).get(SESSION_COOKIE)?.value, secret))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { lumaEventId?: string; hidden?: boolean };
  const lumaEventId = String(body.lumaEventId ?? "").trim();
  if (!lumaEventId) {
    return NextResponse.json({ ok: false, error: "lumaEventId required" }, { status: 400 });
  }
  const { error } = await getAdminClient()
    .from("events")
    .update({ hidden: !!body.hidden })
    .eq("luma_event_id", lumaEventId);
  if (error) {
    console.error("[events/hide] update failed", error);
    return NextResponse.json({ ok: false, error: "update failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, hidden: !!body.hidden });
}
