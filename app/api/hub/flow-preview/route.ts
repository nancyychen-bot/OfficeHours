import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { previewTemplateFor, type CommsKind, type Recipient } from "@/lib/email/templates";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const secret = process.env.HUB_SESSION_SECRET;
  if (!secret || !(await isValidSession((await cookies()).get(SESSION_COOKIE)?.value, secret))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") as CommsKind | null;
  const role = (url.searchParams.get("role") as Recipient | null) ?? "guest";
  if (!kind) return NextResponse.json({ error: "kind required" }, { status: 400 });
  const preview = previewTemplateFor(kind, role);
  if (!preview) return NextResponse.json({ error: "no template" }, { status: 404 });
  return NextResponse.json(preview);
}
