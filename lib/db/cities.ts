import { getAdminClient } from "../supabase/admin";
import type { CityRow } from "../comms/city";
import { cityForEvent } from "../comms/city";
import { toSentLogRows, type RawLogRow, type SentLogRow } from "../comms/log";

/** All registry cities, ordered by name. */
export async function listCities(): Promise<CityRow[]> {
  const { data, error } = await getAdminClient()
    .from("cities")
    .select("slug,name,locale,luma_calendar,aliases")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CityRow[];
}

/** One city by slug, or null. */
export async function getCityBySlug(slug: string): Promise<CityRow | null> {
  const { data, error } = await getAdminClient()
    .from("cities")
    .select("slug,name,locale,luma_calendar,aliases")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return (data as CityRow) ?? null;
}

/** Emails actually sent for a city's events (newest first). Resolves city → events
 * → bookings → email_log, then joins guest names. Read-only. */
export async function listCitySentLog(slug: string, limit = 200): Promise<SentLogRow[]> {
  const supabase = getAdminClient();
  const cities = await listCities();
  const { data: events } = await supabase.from("events").select("id,city,luma_calendar");
  const eventIds = (events ?? []).filter((e) => cityForEvent(e as { city: string | null; luma_calendar: string | null }, cities) === slug).map((e) => e.id as string);
  if (eventIds.length === 0) return [];

  const { data: bookings } = await supabase.from("booking_details").select("id,guest_name,event_id").in("event_id", eventIds);
  const bookingIds = (bookings ?? []).map((b) => b.id as string);
  const guestByBooking = new Map<string, string | null>();
  for (const b of bookings ?? []) guestByBooking.set(b.id as string, (b.guest_name as string) ?? null);
  if (bookingIds.length === 0) return [];

  const { data: logs } = await supabase
    .from("email_log")
    .select("booking_id,event_kind,recipient_role,recipient_email,status,created_at")
    .in("booking_id", bookingIds)
    .order("created_at", { ascending: false })
    .limit(limit);
  return toSentLogRows((logs ?? []) as unknown as RawLogRow[], guestByBooking);
}
