import { getAdminClient } from "../supabase/admin";
import { listEventsInDateRange } from "../db/events";
import { isSendDue, scanWindow } from "./schedule";
import { renderAgenda, type AgendaItem, type OverrideMap } from "../email/templates";
import { getLiveOverrideMap } from "../db/email-overrides";
import { reserveCommsSlot, finalizeComms } from "../db/email-log";
import { sendEmail } from "../email/resend";
import { env } from "../env";
import { logSync } from "../sync/log";
import { dmByEmail } from "../slack/api";
import { buildAgendaBlocks } from "../slack/blocks";

interface DetailRow {
  id: string;
  guest_name: string | null;
  challenge: string | null;
  role: string | null;
  company: string | null;
  slot_name: string | null;
  slot_starts_at: string | null;
  booked_by_email: string | null;
  booked_by_display_name: string | null;
  status: string | null;
  event_name: string | null;
  event_date: string | null;
}

export interface ExpertAgenda {
  email: string;
  name: string;
  anchorBookingId: string;
  eventName: string | null;
  eventDate: string | null;
  items: AgendaItem[];
}

/** Pure: group an event's claimed bookings into one agenda per expert (by email),
 * items sorted by slot start. Only bookings with an expert + not cancelled/no-show. */
export function buildAgendas(rows: DetailRow[]): ExpertAgenda[] {
  const byEmail = new Map<string, ExpertAgenda>();
  for (const r of rows) {
    if (!r.booked_by_email) continue;
    if (r.status !== "assigned" && r.status !== "checked_in") continue;
    const key = r.booked_by_email.trim().toLowerCase();
    const a =
      byEmail.get(key) ??
      {
        email: r.booked_by_email,
        name: r.booked_by_display_name ?? "there",
        anchorBookingId: r.id,
        eventName: r.event_name,
        eventDate: r.event_date,
        items: [] as AgendaItem[],
      };
    a.items.push({
      guestName: r.guest_name ?? "Guest",
      slotName: r.slot_name,
      slotStartsAt: r.slot_starts_at,
      challenge: r.challenge,
      role: r.role,
      company: r.company,
    });
    byEmail.set(key, a);
  }
  for (const a of byEmail.values()) {
    a.items.sort((x, y) => (x.slotStartsAt ?? "").localeCompare(y.slotStartsAt ?? ""));
  }
  return [...byEmail.values()];
}

/** Email each expert their schedule for one event. Idempotent via email_log dedup. */
export async function sendAgendasForEvent(eventId: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getAdminClient() as any;
  const { data } = await supabase
    .from("booking_details")
    .select("id, guest_name, challenge, role, company, slot_name, slot_starts_at, booked_by_email, booked_by_display_name, status, event_name, event_date")
    .eq("event_id", eventId);
  const agendas = buildAgendas((data ?? []) as DetailRow[]);
  let overrides: OverrideMap = new Map();
  try { overrides = await getLiveOverrideMap(); } catch { /* fall back to defaults */ }

  let sent = 0;
  for (const a of agendas) {
    // Additive Slack DM (best-effort; email still sends below and is the source of truth).
    try {
      const dm = buildAgendaBlocks(a);
      await dmByEmail(a.email, dm, `Your Build Bar schedule today — ${a.eventName ?? "Build Bar"}`);
    } catch (err) {
      await logSync({ direction: "luma_in", result: "error", bookingId: a.anchorBookingId, action: "agenda_dm", note: err instanceof Error ? err.message : String(err) });
    }

    const firstName = (a.name.trim().split(/\s+/)[0] || "there");
    const rendered = renderAgenda({ firstName, eventName: a.eventName, eventDate: a.eventDate, items: a.items }, overrides);
    if (!(await reserveCommsSlot(a.anchorBookingId, "day_of_agenda", "helper", a.email))) continue;
    if (!env.comms.enabled()) {
      await finalizeComms(a.anchorBookingId, "day_of_agenda", a.email, { resendId: null, status: "skipped" });
      continue;
    }
    try {
      const { id } = await sendEmail({ to: a.email, subject: rendered.subject, html: rendered.html, text: rendered.text });
      if (!id) throw new Error("Resend returned no message id");
      await finalizeComms(a.anchorBookingId, "day_of_agenda", a.email, { resendId: id, status: "sent" });
      sent++;
    } catch (err) {
      await finalizeComms(a.anchorBookingId, "day_of_agenda", a.email, { resendId: null, status: "failed" });
      await logSync({ direction: "luma_in", result: "error", bookingId: a.anchorBookingId, action: "day_of_agenda", note: err instanceof Error ? err.message : String(err) });
    }
  }
  return sent;
}

/** Send each expert's day-of agenda at 9am local on the event day. */
export async function sendAgendasForToday(now: Date = new Date()): Promise<{ events: number; experts: number }> {
  const { from, to } = scanWindow(now);
  const events = (await listEventsInDateRange(from, to)).filter((e) => isSendDue(now, e, { offsetDays: 0, targetHour: 9 }));
  let experts = 0;
  for (const ev of events) experts += await sendAgendasForEvent(ev.id);
  return { events: events.length, experts };
}
