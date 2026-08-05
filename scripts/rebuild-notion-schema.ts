/**
 * Idempotently bring both Bookings data sources up to the current schema:
 * ensures Luma Status, the "No help needed" Status option, and the new intake
 * properties exist. Existing properties/options are preserved (Notion merges by
 * name); re-running is a no-op for already-present props/options.
 *
 * Two independent update calls: (1) the additive intake properties, (2) the
 * Status/Luma-Status option ensures. Splitting them means re-sending existing
 * select properties can't block the additive props (observed on the Dev DB).
 *
 * Usage: npx tsx --env-file=.env.local scripts/rebuild-notion-schema.ts
 */
import { getNotionClient, bookingsDataSourceId, type NotionWorkspace } from "../lib/notion/client";
import { PROP, STATUS_LABEL, LUMA_STATUS_LABEL } from "../lib/notion/schema";

// New registration-form fields (purely additive).
const INTAKE_PROPERTIES: Record<string, unknown> = {
  [PROP.notionEmail]: { rich_text: {} },
  [PROP.notionPlan]: { select: { options: [
    { name: "Enterprise" }, { name: "Business" }, { name: "Plus" }, { name: "Free" },
  ] } },
  // Experience-level options auto-populate from real data (exact Luma labels).
  [PROP.experienceLevel]: { select: {} },
  [PROP.reasons]: { multi_select: { options: [
    { name: "I need 1:1 help" }, { name: "I want to cowork" }, { name: "Just checking it out" },
  ] } },
  [PROP.requestedSlot]: { rich_text: {} },
};

// Status/Luma-Status option ensures (no-op where already present).
const STATUS_PROPERTIES: Record<string, unknown> = {
  [PROP.lumaStatus]: { select: { options: [
    { name: LUMA_STATUS_LABEL.pending, color: "blue" },
    { name: LUMA_STATUS_LABEL.approved, color: "green" },
    { name: LUMA_STATUS_LABEL.waitlist, color: "yellow" },
    { name: LUMA_STATUS_LABEL.declined, color: "red" },
  ] } },
  [PROP.status]: { select: { options: [
    { name: STATUS_LABEL.no_help_needed, color: "red" },
    { name: STATUS_LABEL.unassigned, color: "gray" },
    { name: STATUS_LABEL.assigned, color: "blue" },
    { name: STATUS_LABEL.checked_in, color: "green" },
    { name: STATUS_LABEL.no_show, color: "red" },
    { name: STATUS_LABEL.cancelled, color: "orange" },
  ] } },
};

async function update(
  workspace: NotionWorkspace,
  label: string,
  properties: Record<string, unknown>,
) {
  const notion = getNotionClient(workspace);
  const dsId = bookingsDataSourceId(workspace);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (notion as any).dataSources.update({ data_source_id: dsId, properties });
    console.log(`[${workspace}] ${label}: ok`);
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detail = (err as any)?.body ?? (err instanceof Error ? err.message : err);
    console.error(`[${workspace}] ${label}: FAILED`, detail);
  }
}

async function main() {
  for (const ws of ["dev", "ambassador"] as const) {
    await update(ws, "intake fields", INTAKE_PROPERTIES);
    await update(ws, "status options", STATUS_PROPERTIES);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
