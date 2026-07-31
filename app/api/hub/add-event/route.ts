import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyFormToken } from "@/lib/auth/form-token";
import { registerEventFromLuma } from "@/lib/events/register";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  if (!(await verifyFormToken(token, env.hub.sessionSecret(), Date.now()))) {
    return NextResponse.json({ ok: false, error: "Invalid or expired form token. Reload the page and try again." }, { status: 400 });
  }

  const lumaEvent = String(form.get("lumaEvent") ?? "").trim();
  if (!lumaEvent) {
    return NextResponse.json({ ok: false, error: "A Luma event URL or id is required." }, { status: 400 });
  }
  const city = String(form.get("city") ?? "").trim() || undefined;
  const slotStart = String(form.get("slotStart") ?? "").trim() || undefined;
  const lengthRaw = String(form.get("length") ?? "").trim();
  const slotLengthMinutes = lengthRaw ? Number(lengthRaw) : undefined;

  try {
    const result = await registerEventFromLuma({ lumaEvent, city, slotStart, slotLengthMinutes });
    return NextResponse.json({
      ok: true,
      event: {
        name: result.eventName,
        slots: result.inserted + result.updated,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
