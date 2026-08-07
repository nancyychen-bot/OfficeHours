import { NextResponse } from "next/server";
import { changeSlot } from "@/lib/events/slot-change";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Public: change a booking's slot (verifies the booking belongs to the email). */
export async function POST(req: Request) {
  let body: { bookingId?: string; email?: string; newSlotId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { bookingId, email, newSlotId } = body;
  if (!bookingId || !email || !newSlotId) {
    return NextResponse.json({ error: "Missing details. Please start over." }, { status: 400 });
  }
  try {
    const r = await changeSlot(bookingId, email, newSlotId);
    if (!r.ok) return NextResponse.json({ error: r.error ?? "Couldn't change the slot." }, { status: 400 });
    return NextResponse.json(r);
  } catch {
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
