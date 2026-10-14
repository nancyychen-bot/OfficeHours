import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyBookingToken } from "@/lib/auth/booking-token";
import { getBookingById } from "@/lib/db/bookings";
import { getEventById } from "@/lib/db/events";
import { lumaCalendars } from "@/lib/luma/calendars";
import { getLumaEvent, extractSlotOptions } from "@/lib/luma/client";

export const runtime = "nodejs";

/** Shape sent to the form: enough to render each question + prefill known values. */
interface LoadQuestion { id: string; label: string; kind: "text" | "select" | "slot"; options: string[] }

/** Coerce a Luma option (string or {label|name|value|text}) to its display label.
 * Mirrors the private `optionLabel` in lib/luma/client.ts. */
function optionLabel(o: unknown): string {
  if (typeof o === "string") return o;
  if (o && typeof o === "object") {
    const r = o as Record<string, unknown>;
    for (const k of ["label", "name", "value", "text"]) {
      if (typeof r[k] === "string") return r[k] as string;
    }
  }
  return String(o);
}

export async function POST(req: Request) {
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  if (!token) return NextResponse.json({ error: "Missing link." }, { status: 400 });

  const bookingId = await verifyBookingToken(token, env.hub.sessionSecret(), Date.now());
  if (!bookingId) return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 400 });

  const booking = await getBookingById(bookingId);
  if (!booking) return NextResponse.json({ error: "Registration not found." }, { status: 404 });
  const event = await getEventById(booking.event_id);
  if (!event?.luma_event_id) return NextResponse.json({ error: "Event unavailable." }, { status: 404 });

  // Fetch the event's real Luma questions from the owning calendar.
  let questions: LoadQuestion[] = [];
  for (const cal of await lumaCalendars()) {
    try {
      const detail = await getLumaEvent(event.luma_event_id, cal.apiKey);
      const slotLabels = extractSlotOptions(detail.registration_questions ?? []);
      const slotSet = new Set(slotLabels);
      questions = (detail.registration_questions ?? []).map((q, i) => {
        const options = (q.options ?? []).map(optionLabel);
        const isSlot = options.length > 0 && slotLabels.length > 0 && options.every((o) => slotSet.has(o));
        return {
          id: q.id ?? `q${i}`,
          label: q.label ?? `Question ${i + 1}`,
          kind: (isSlot ? "slot" : options.length > 0 ? "select" : "text") as LoadQuestion["kind"],
          options,
        };
      });
      break;
    } catch {
      /* not this calendar's event — try the next key */
    }
  }
  if (questions.length === 0) {
    return NextResponse.json({ error: "This event's form is unavailable right now." }, { status: 502 });
  }

  return NextResponse.json({
    eventName: event.name,
    prefill: {
      challenge: booking.challenge,
      role: booking.role,
      company: booking.company,
      requestedSlot: booking.requested_slot,
    },
    questions,
  });
}
