import { getAdminClient } from "../supabase/admin";
import type { CityRow } from "../comms/city";

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
