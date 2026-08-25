import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { getSentEmail } from "@/lib/email/resend";
import { isOwnResendId } from "@/lib/db/email-log";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authed(): Promise<boolean> {
  const secret = process.env.HUB_SESSION_SECRET;
  if (!secret) return false;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSession(token, secret);
}

export async function GET(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const resendId = new URL(req.url).searchParams.get("resendId") ?? "";
  // Validate the shape and scope it to OUR sends, so this can't be used to fetch
  // arbitrary emails from the whole Resend account.
  if (!UUID_RE.test(resendId) || !(await isOwnResendId(resendId))) {
    return NextResponse.json({ email: null }, { status: 404 });
  }
  const email = await getSentEmail(resendId);
  return NextResponse.json({ email });
}
