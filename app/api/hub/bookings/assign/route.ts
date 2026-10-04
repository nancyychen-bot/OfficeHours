import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { assignExpert } from "@/lib/events/assign";

export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const secret = process.env.HUB_SESSION_SECRET;
  if (!secret) return false;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSession(token, secret);
}

/**
 * Assign a specific expert to a booking live from the hub. Handles unassigned 1:1s,
 * cowork/no-help attendees who now want one, and reassignments. Sends the expert
 * the calendar invite + Slack DM and mirrors both Notion cards.
 */
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const bookingId = typeof body.bookingId === "string" ? body.bookingId : "";
  const displayName = typeof body.displayName === "string" ? body.displayName : "";
  const email = typeof body.email === "string" ? body.email : "";
  const type = body.type === "ambassador" ? "ambassador" : body.type === "employee" ? "employee" : null;

  if (!bookingId) return NextResponse.json({ error: "booking id required" }, { status: 400 });
  if (!type) return NextResponse.json({ error: "Expert type (employee/ambassador) is required." }, { status: 400 });

  try {
    const res = await assignExpert({ bookingId, displayName, email, type });
    if (!res.ok) return NextResponse.json({ error: res.error ?? "failed" }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
