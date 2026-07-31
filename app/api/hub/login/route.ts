import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { constantTimeEquals } from "@/lib/auth/token";
import { issueSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const ok = constantTimeEquals(password, env.hub.password());
  if (!ok) {
    return NextResponse.redirect(new URL("/login?error=1", req.url), { status: 303 });
  }
  const token = await issueSession(env.hub.sessionSecret());
  const res = NextResponse.redirect(new URL("/", req.url), { status: 303 });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
