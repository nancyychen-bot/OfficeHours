import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";
import { getAdminClient } from "@/lib/supabase/admin";
import { getBookingById, getBookingDetailsById } from "@/lib/db/bookings";
import { pushBookingToWorkspaces } from "@/lib/notion/push";
import { logSync } from "@/lib/sync/log";

export const runtime = "nodejs";

async function authed(): Promise<boolean> {
  const secret = process.env.HUB_SESSION_SECRET;
  if (!secret) return false;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSession(token, secret);
}

// Guest-info fields safe to edit from the hub (source of truth). Workflow fields
// (status, booked_by, luma_status, slot) have their own flows and are excluded;
// guest_email is the Luma join key and is NOT editable here.
const EDITABLE = ["guest_name", "role", "company", "challenge", "guest_phone"] as const;

export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "booking id required" }, { status: 400 });

  const update: Record<string, string | null> = {};
  for (const f of EDITABLE) {
    if (f in body) {
      const v = body[f];
      update[f] = v == null || v === "" ? null : String(v);
    }
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: "no editable fields provided" }, { status: 400 });
  if (update.guest_name === null) return NextResponse.json({ error: "Guest name can't be empty." }, { status: 400 });

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (getAdminClient() as any).from("bookings").update(update).eq("id", id);
    if (error) throw new Error(error.message);

    // Push the corrected values to BOTH cards immediately (source of truth wins).
    const booking = await getBookingById(id);
    const d = await getBookingDetailsById(id);
    if (booking) {
      const opts = {
        slotLabel: (d?.slot_name as string) ?? undefined,
        location: (d?.location as string) ?? undefined,
        eventName: (d?.event_name as string) ?? undefined,
        eventDate: (d?.event_date as string) ?? undefined,
      };
      await pushBookingToWorkspaces(booking, { fullUpdate: true, dev: opts, ambassador: opts });
    }
    await logSync({ direction: "luma_in", result: "applied", bookingId: id, action: "hub_edit", note: Object.keys(update).join(",") });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
