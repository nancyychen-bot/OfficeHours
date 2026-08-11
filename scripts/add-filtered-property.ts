// scripts/add-filtered-property.ts
// Run once: add the "Filtered" checkbox property to BOTH bookings data sources
// (Dev + Ambassador). Notion API v2025-09-03: schema lives on the data source, so
// we use dataSources.update (databases.update silently ignores `properties`).
// Usage: npm run setup:filtered
import { Client } from "@notionhq/client";

async function addFiltered(token: string | undefined, dataSourceId: string | undefined, label: string) {
  if (!token || !dataSourceId) {
    console.warn(`skip ${label}: missing token or data source id`);
    return;
  }
  const notion = new Client({ auth: token });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (notion.dataSources.update as any)({
    data_source_id: dataSourceId,
    properties: { Filtered: { type: "checkbox", checkbox: {} } },
  });
  console.log(`${label}: Filtered checkbox ensured`);
}

async function main() {
  await addFiltered(process.env.NOTION_DEV_TOKEN, process.env.NOTION_DEV_BOOKINGS_DATA_SOURCE_ID, "dev");
  await addFiltered(process.env.NOTION_AMBASSADOR_TOKEN, process.env.NOTION_AMBASSADOR_BOOKINGS_DATA_SOURCE_ID, "ambassador");
}

main().catch((e) => { console.error(e); process.exit(1); });
