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
    // This route is public + embeddable — don't echo raw internal/upstream
    // error text (Luma API details, DB messages) to anonymous callers. Log the
    // real error server-side; return a generic, actionable message.
    console.error("[add-event] register failed", err);
    return NextResponse.json(
      { ok: false, error: "Couldn't add that event. Check the Luma URL and try again." },
      { status: 400 },
    );
  }
}
