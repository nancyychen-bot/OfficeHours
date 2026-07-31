import { NextResponse, type NextRequest } from "next/server";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Guard the dashboard root. `/login`, `/add-event`, `/api/*`, and static assets
 * are public (see `matcher`). Without a valid session cookie, redirect to login.
 */
export async function middleware(req: NextRequest) {
  const secret = process.env.HUB_SESSION_SECRET ?? "";
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (await isValidSession(token, secret)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

// Only guard the dashboard root. Everything else is public or handled per-route.
export const config = {
  matcher: ["/"],
};
