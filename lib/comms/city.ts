export interface CityRow {
  slug: string;
  name: string;
  locale: string;
  luma_calendar: string | null;
  aliases: string[];
}

/** Resolve an event to a canonical city slug, or null. Order: exact name match,
 * then alias match (both case-insensitive), then a calendar that belongs to
 * exactly one city (unique → unambiguous; shared like notion-master → null). */
export function cityForEvent(
  event: { city: string | null; luma_calendar: string | null },
  cities: CityRow[],
): string | null {
  const city = (event.city ?? "").trim().toLowerCase();
  if (city) {
    const byName = cities.find((c) => c.name.trim().toLowerCase() === city);
    if (byName) return byName.slug;
    const byAlias = cities.find((c) => c.aliases.some((a) => a.trim().toLowerCase() === city));
    if (byAlias) return byAlias.slug;
  }
  const cal = (event.luma_calendar ?? "").trim();
  if (cal) {
    const onCal = cities.filter((c) => (c.luma_calendar ?? "") === cal);
    if (onCal.length === 1) return onCal[0].slug;
  }
  return null;
}
