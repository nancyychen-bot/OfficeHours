import { getNotionClient, bookingsDataSourceId, type NotionWorkspace } from "./client";
import { PROP } from "./schema";

/** A Notion select option as returned by / sent to the data-source schema. */
export interface SelectOption {
  id?: string;
  name: string;
  color?: string;
}

/**
 * Given the current Location select options and a city, return the option list to
 * write back — existing options untouched (ids/colors preserved) with the city
 * appended — or `null` if the city is already an option (exact match after
 * trimming). Pure: no Notion calls, so it's the unit under test.
 */
export function mergeLocationOptions(
  existing: SelectOption[],
  city: string,
): SelectOption[] | null {
  const name = city.trim();
  if (existing.some((o) => o.name === name)) return null;
  return [...existing, { name }];
}

/**
 * Ensure `city` is an option in the Location select on both bookings data sources
 * (Dev + Ambassador), so an event's city is filterable in Notion before its first
 * registrant is written. Additive only — never removes/renames existing options.
 * Per-workspace try/catch so one workspace failing doesn't block the other.
 * Schema lives on the data source (Notion API v2025-09-03): use dataSources.*.
 */
export async function ensureLocationOption(city: string): Promise<void> {
  const name = city.trim();
  if (!name) return;
  for (const workspace of ["dev", "ambassador"] as const) {
    try {
      await ensureForWorkspace(workspace, name);
    } catch (err) {
      console.error(`[location-options] ${workspace}: ensure "${name}" failed`, err);
    }
  }
}

async function ensureForWorkspace(workspace: NotionWorkspace, name: string): Promise<void> {
  const notion = getNotionClient(workspace);
  const dataSourceId = bookingsDataSourceId(workspace);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ds: any = await (notion.dataSources.retrieve as any)({ data_source_id: dataSourceId });
  const existing: SelectOption[] = ds?.properties?.[PROP.location]?.select?.options ?? [];
  const merged = mergeLocationOptions(existing, name);
  if (!merged) return; // already present
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (notion.dataSources.update as any)({
    data_source_id: dataSourceId,
    properties: { [PROP.location]: { select: { options: merged } } },
  });
}
