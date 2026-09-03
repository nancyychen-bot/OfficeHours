import { getAdminClient } from "../supabase/admin";
import { lumaCalendars, calendarUrlForCalendar } from "../luma/calendars";
import { listLumaCalendarRows } from "../db/luma-calendars";
import { validateLumaKey } from "../luma/client";
import { getSlackChannelForCity } from "../db/slack";
import { isBotInChannel } from "../slack/api";
import { evaluateEvent, evaluateCalendar, type Issue } from "./evaluate";

export interface CalendarReport {
  id: string;
  /** Distinct cities of this calendar's events — a calendar can host many
   * (North America = one calendar for NYC, SF, …). Empty until it has events. */
  cities: string[];
  calendarId: string | null;
  calendarUrl: string | null;
  issues: Issue[];
}
export interface EventReport {
  lumaEventId: string | null;
  name: string;
  city: string | null;
  eventDate: string;
  lumaCalendar: string | null;
  /** Operator marked this event's setup complete (drops it from the alert email). */
  acked: boolean;
  issues: Issue[];
}
export interface ReadinessReport {
  generatedForDays: number;
  calendars: CalendarReport[];
  events: EventReport[];
  errorCount: number;
  warnCount: number;
}

const DEFAULT_WINDOW_DAYS = 21;

/**
 * Gather live setup health across every connected calendar and every upcoming
 * event: validates each Luma key, checks webhook secrets, slot counts, city,
 * timezone, address, and Slack channel + bot membership. Pure evaluation lives in
 * ./evaluate; this layer only fetches.
 */
export async function checkReadiness(withinDays = DEFAULT_WINDOW_DAYS): Promise<ReadinessReport> {
  const supabase = getAdminClient();
  const cals = await lumaCalendars();
  const knownIds = new Set(cals.map((c) => c.id));
  // DB rows carry calendar_url + cal- id (env-only calendars won't be here; their
  // URL still resolves via calendarUrlForCalendar → LUMA_CALENDAR_URL env).
  const dbById = new Map((await listLumaCalendarRows()).map((r) => [r.id, r]));

  // Distinct cities each calendar actually hosts, across ALL its events (a master
  // calendar spans many cities). null luma_calendar → the 'default' calendar.
  const { data: cityRows } = await supabase.from("events").select("luma_calendar, city").not("city", "is", null);
  const citiesByCal = new Map<string, Set<string>>();
  for (const r of cityRows ?? []) {
    const cid = (r.luma_calendar as string) || "default";
    (citiesByCal.get(cid) ?? citiesByCal.set(cid, new Set()).get(cid)!).add(r.city as string);
  }

  const calendars: CalendarReport[] = await Promise.all(
    cals.map(async (c) => {
      const row = dbById.get(c.id);
      return {
        id: c.id,
        cities: [...(citiesByCal.get(c.id) ?? [])].sort(),
        calendarId: row?.calendarId ?? null,
        calendarUrl: row?.calendarUrl ?? (await calendarUrlForCalendar(c.id)),
        issues: evaluateCalendar({ keyValid: await validateLumaKey(c.apiKey), hasWebhookSecret: !!c.webhookSecret }),
      };
    }),
  );

  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + withinDays * 86_400_000).toISOString().slice(0, 10);
  const { data: eventRows } = await supabase
    .from("events")
    .select("id, name, city, timezone, address, event_date, luma_calendar, luma_event_id, readiness_acked_at, status")
    .gte("event_date", today)
    .lte("event_date", until)
    .neq("status", "cancelled")
    .order("event_date");
  const events = eventRows ?? [];

  const ids = events.map((e) => e.id as string);
  const slotCounts = new Map<string, number>();
  if (ids.length) {
    const { data: slotRows } = await supabase.from("slots").select("event_id").in("event_id", ids);
    for (const s of slotRows ?? []) {
      const eid = s.event_id as string;
      slotCounts.set(eid, (slotCounts.get(eid) ?? 0) + 1);
    }
  }

  const eventReports: EventReport[] = await Promise.all(
    events.map(async (e) => {
      const city = (e.city as string) ?? null;
      const channel = city ? await getSlackChannelForCity(city) : null;
      const slack = channel
        ? {
            postable: true,
            channelName: channel.channelName,
            botInChannel: channel.channelId ? await isBotInChannel(channel.channelId) : null,
          }
        : null;
      const issues = evaluateEvent({
        city,
        timezone: (e.timezone as string) ?? null,
        address: (e.address as string) ?? null,
        slotCount: slotCounts.get(e.id as string) ?? 0,
        calendarConnected: knownIds.has((e.luma_calendar as string) || "default"),
        slack,
      });
      return {
        lumaEventId: (e.luma_event_id as string) ?? null,
        name: e.name as string,
        city,
        eventDate: e.event_date as string,
        lumaCalendar: (e.luma_calendar as string) ?? null,
        acked: !!e.readiness_acked_at,
        issues,
      };
    }),
  );

  const all = [...calendars.flatMap((c) => c.issues), ...eventReports.flatMap((e) => e.issues)];
  return {
    generatedForDays: withinDays,
    calendars,
    events: eventReports,
    errorCount: all.filter((i) => i.level === "error").length,
    warnCount: all.filter((i) => i.level === "warn").length,
  };
}

/** Calendars/events that have issues — for the email digest. Events the operator
 * marked complete are excluded (they've taken ownership); the page still shows
 * their live status. */
export function problemsOnly(r: ReadinessReport): { calendars: CalendarReport[]; events: EventReport[] } {
  return {
    calendars: r.calendars.filter((c) => c.issues.length),
    events: r.events.filter((e) => e.issues.length && !e.acked),
  };
}
