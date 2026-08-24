import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { listGroupRecipients } from "@/lib/db/email-correspondence";

export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const secret = process.env.HUB_SESSION_SECRET;
  if (!secret) return false;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSession(token, secret);
}

export async function GET(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const day = url.searchParams.get("day");
  if (!kind || !day) return NextResponse.json({ error: "missing kind/day" }, { status: 400 });
  const recipients = await listGroupRecipients({ kind, eventId: url.searchParams.get("event"), day });
  return NextResponse.json({ recipients });
}
