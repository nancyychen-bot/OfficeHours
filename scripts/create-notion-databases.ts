/**
 * One-time setup: create the Bookings database in each Notion workspace via the
 * API, then print the database + data-source ids to paste into .env.local.
 *
 * Prereqs (see PRD §13 / README): NOTION_DEV_TOKEN and/or NOTION_AMBASSADOR_TOKEN
 * set, and a parent PAGE in each workspace that the integration has been shared
 * with (page → ••• → Connections → add your integration).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/create-notion-databases.ts \
 *     --dev-parent <DEV_PARENT_PAGE_ID> --amb-parent <AMB_PARENT_PAGE_ID> \
 *     [--cities SF,NYC,Tokyo,London]
 *
 * Provide only the flags for the workspaces you're setting up.
 */
import { getNotionClient } from "../lib/notion/client";
import { createBookingsDatabase } from "../lib/notion/schema";

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const devParent = getArg("--dev-parent");
  const ambParent = getArg("--amb-parent");
  const cities = (getArg("--cities") ?? "SF,NYC").split(",").map((c) => c.trim()).filter(Boolean);

  if (!devParent && !ambParent) {
    console.error("Provide at least one of --dev-parent / --amb-parent (a Notion page id).");
    process.exit(1);
  }

  if (devParent) {
    const res = await createBookingsDatabase(getNotionClient("dev"), "dev", devParent, cities);
    console.log("\n[Notion Dev] Bookings database created:");
    console.log(`  NOTION_DEV_BOOKINGS_DB_ID=${res.databaseId}`);
    console.log(`  NOTION_DEV_BOOKINGS_DATA_SOURCE_ID=${res.dataSourceId}`);
  }

  if (ambParent) {
    const res = await createBookingsDatabase(getNotionClient("ambassador"), "ambassador", ambParent, cities);
    console.log("\n[Ambassador] Bookings database created:");
    console.log(`  NOTION_AMBASSADOR_BOOKINGS_DB_ID=${res.databaseId}`);
    console.log(`  NOTION_AMBASSADOR_BOOKINGS_DATA_SOURCE_ID=${res.dataSourceId}`);
  }

  console.log("\nDone. Paste the ids above into .env.local, then share each DB with its integration.");
}

main().catch((err) => {
  console.error("create-notion-databases failed:", err);
  process.exit(1);
});
