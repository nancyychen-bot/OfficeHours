import { NextResponse, type NextRequest } from "next/server";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Guard everything except the known-public paths (`/login`, `/add-event`,
 * `/api/*`, and static assets — see `matcher`). Without a valid session cookie,
 * redirect to login. This is deny-by-default: any new page/route is guarded
 * unless explicitly excluded, so a future data route can't ship wide open.
 */
export async function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";

  // Fail closed: if the signing secret is missing (e.g. not deployed to the
  // Edge runtime), NEVER verify against an empty key — that would let anyone
  // forge a cookie. Treat it as unauthenticated.
  const secret = process.env.HUB_SESSION_SECRET;
  if (!secret) return NextResponse.redirect(url);

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (await isValidSession(token, secret)) return NextResponse.next();
  return NextResponse.redirect(url);
}

// Guard all paths EXCEPT the public routes and static assets. The public API
// routes (`/api/hub/login`, `/api/hub/add-event`) self-verify (password / form
// token), so they're excluded here and gated per-route instead.
export const config = {
  matcher: ["/((?!login|add-event|change-slot|embed|api|_next/static|_next/image|favicon.ico).*)"],
};
