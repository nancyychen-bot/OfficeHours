import { getAdminClient } from "../supabase/admin";

export interface LumaCalendarRow {
  id: string;
  apiKey: string;
  webhookSecret: string | null;
  calendarId: string | null;
  city: string | null;
  calendarUrl: string | null;
}

interface RawRow {
  id: string;
  api_key: string;
  webhook_secret: string | null;
  calendar_id: string | null;
  city: string | null;
  calendar_url: string | null;
}

/** Pure snake_case → camelCase mapping (unit-tested without a DB). */
export function mapCalendarRow(r: RawRow): LumaCalendarRow {
  return {
    id: r.id,
    apiKey: r.api_key,
    webhookSecret: r.webhook_secret,
    calendarId: r.calendar_id,
    city: r.city,
    calendarUrl: r.calendar_url,
  };
}

const COLS = "id, api_key, webhook_secret, calendar_id, city, calendar_url";

/** All calendar rows. Throws on a DB error so callers can fail loud. */
export async function listLumaCalendarRows(): Promise<LumaCalendarRow[]> {
  const { data, error } = await getAdminClient().from("luma_calendars").select(COLS);
  if (error) throw error;
  return (data ?? []).map((r) => mapCalendarRow(r as RawRow));
}

/** Create or replace a calendar (keyed on id/slug). */
export async function upsertLumaCalendar(input: LumaCalendarRow): Promise<void> {
  const { error } = await getAdminClient().from("luma_calendars").upsert(
    {
      id: input.id,
      api_key: input.apiKey,
      webhook_secret: input.webhookSecret,
      calendar_id: input.calendarId,
      city: input.city,
      calendar_url: input.calendarUrl,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) throw error;
}

/** Find a calendar by its Luma cal- id (used to detect already-connected calendars). */
export async function getLumaCalendarByCalendarId(calendarId: string): Promise<LumaCalendarRow | null> {
  const { data } = await getAdminClient().from("luma_calendars").select(COLS).eq("calendar_id", calendarId).maybeSingle();
  return data ? mapCalendarRow(data as RawRow) : null;
}
