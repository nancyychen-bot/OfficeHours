import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { listAdmins, addAdmin, removeAdmin } from "@/lib/db/admins";

export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const secret = process.env.HUB_SESSION_SECRET;
  if (!secret) return false;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSession(token, secret);
}

export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, admins: await listAdmins() });
}

/** action=add | action=remove — manage who can unclaim any spot. */
export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { action?: string; email?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }
  try {
    if (body.action === "add") { await addAdmin(email); return NextResponse.json({ ok: true }); }
    if (body.action === "remove") { await removeAdmin(email); return NextResponse.json({ ok: true }); }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
