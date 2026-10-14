import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyBookingToken } from "@/lib/auth/booking-token";
import { getBookingById } from "@/lib/db/bookings";
import { getEventById } from "@/lib/db/events";
import { normalizeGuest } from "@/lib/luma/parse";
import { ingestRegistration } from "@/lib/events/ingest";
import { logSync } from "@/lib/sync/log";
import { buildGuestData, type SubmittedAnswer } from "./build";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { token, answers } = (await req.json().catch(() => ({}))) as { token?: string; answers?: SubmittedAnswer[] };
  if (!token || !Array.isArray(answers)) return NextResponse.json({ error: "Invalid submission." }, { status: 400 });

  const bookingId = await verifyBookingToken(token, env.hub.sessionSecret(), Date.now());
  if (!bookingId) return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 400 });

  const booking = await getBookingById(bookingId);
  if (!booking) return NextResponse.json({ error: "Registration not found." }, { status: 404 });
  if (!booking.luma_guest_id) return NextResponse.json({ error: "Registration not found." }, { status: 404 });
  const event = await getEventById(booking.event_id);
  if (!event?.luma_event_id) return NextResponse.json({ error: "Event unavailable." }, { status: 404 });

  try {
    const data = buildGuestData({
      lumaGuestId: booking.luma_guest_id,
      guestEmail: booking.guest_email,
      lumaEventId: event.luma_event_id,
      guestName: booking.guest_name,
      guestPhone: booking.guest_phone,
      answers,
    });
    // live:false → silent (no assignment emails, no re-sent completion link); still
    // upserts the answers onto the booking and mirrors to both Notion workspaces.
    const outcome = await ingestRegistration(normalizeGuest(data), { live: false });
    if (outcome.status !== "ingested") {
      return NextResponse.json({ error: "Could not save your answers." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, eventName: event.name });
  } catch (err) {
    await logSync({
      direction: "luma_in",
      result: "error",
      action: "complete_registration",
      note: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Something went wrong saving your answers." }, { status: 500 });
  }
}
