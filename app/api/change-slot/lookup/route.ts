import { NextResponse } from "next/server";
import { findChangeableBookings } from "@/lib/events/slot-change";

export const runtime = "nodejs";

/** Public: find a guest's upcoming, re-slottable 1:1 bookings by email. */
export async function POST(req: Request) {
  let body: { email?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
  }
  try {
    const bookings = await findChangeableBookings(email);
    return NextResponse.json({ ok: true, bookings });
  } catch {
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
