import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Save an event's per-event prep-email instructions from the readiness page.
 * Operator-only. Updates only `events.prep_instructions` for the named event, so
 * one city's logistics can never leak into another city's email. Whitespace-only
 * input is stored as null (⇒ the block is omitted — today's exact email). */
export async function POST(req: Request) {
  const secret = process.env.HUB_SESSION_SECRET;
  if (!secret || !(await isValidSession((await cookies()).get(SESSION_COOKIE)?.value, secret))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { lumaEventId?: string; instructions?: string };
  const lumaEventId = String(body.lumaEventId ?? "").trim();
  if (!lumaEventId) {
    return NextResponse.json({ ok: false, error: "lumaEventId required" }, { status: 400 });
  }
  const trimmed = String(body.instructions ?? "").trim();
  const value = trimmed ? trimmed : null;
  const { error } = await getAdminClient()
    .from("events")
    .update({ prep_instructions: value })
    .eq("luma_event_id", lumaEventId);
  if (error) {
    console.error("[event-instructions] update failed", error);
    return NextResponse.json({ ok: false, error: "update failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, instructions: value });
}
