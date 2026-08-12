// scripts/configure-expert-feedback-db.ts
// Run once: sets the Dev "Expert Feedback" data-source schema to match the mapper
// (lib/notion/expert-feedback.ts EF names) and prints the data-source id for
// NOTION_DEV_EXPERT_FEEDBACK_DATA_SOURCE_ID.
// Usage: npm run setup:expert-feedback
//
// Note (Notion API v2025-09-03): a database's editable property schema lives on its
// DATA SOURCE, not the database — so we update via dataSources.update, not
// databases.update (which silently ignores `properties`).
import { Client } from "@notionhq/client";

const DB_ID = process.env.NOTION_DEV_EXPERT_FEEDBACK_DB_ID ?? "3b5b35e6e67f803d9b44e89ebcfa6daa";

async function main() {
  const token = process.env.NOTION_DEV_TOKEN;
  if (!token) throw new Error("NOTION_DEV_TOKEN missing");
  const notion = new Client({ auth: token });

  // Resolve the data source that backs this database.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (await notion.databases.retrieve({ database_id: DB_ID })) as any;
  const ds: string | undefined = db.data_sources?.[0]?.id;
  if (!ds) throw new Error("No data source on this database — is it shared with the Dev integration?");

  // Find the current title property so we can rename it to "Expert" (a data source
  // has exactly one title property; you rename it, you don't add a second).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dsObj = (await notion.dataSources.retrieve({ data_source_id: ds })) as any;
  const titleName =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.entries(dsObj.properties).find(([, v]: [string, any]) => v?.type === "title")?.[0] ?? "Name";

  const properties: Record<string, unknown> = {
    [titleName]: { name: "Expert" }, // rename the existing title → Expert
    "Expert email": { rich_text: {} },
    "Guest": { rich_text: {} },
    "Guest email": { rich_text: {} },
    "Event Date": { date: {} },
    "Location": { rich_text: {} },
    "Event": { rich_text: {} },
    "Slot": { rich_text: {} },
    "Attended": { select: { options: [{ name: "Showed up", color: "green" }, { name: "No-show", color: "red" }] } },
    "Rating": { number: {} },
    "Note": { rich_text: {} },
    "Responded at": { date: {} },
    "Booking ID": { rich_text: {} },
    "Feedback type": { select: { options: [{ name: "Guest", color: "blue" }, { name: "General", color: "purple" }] } },
  };

  // Relation → the Dev Bookings DB, so each feedback entry links to the guest's card.
  const bookingsDs = process.env.NOTION_DEV_BOOKINGS_DATA_SOURCE_ID;
  if (bookingsDs) {
    properties["Booking"] = { type: "relation", relation: { data_source_id: bookingsDs, type: "single_property", single_property: {} } };
  } else {
    console.warn("NOTION_DEV_BOOKINGS_DATA_SOURCE_ID unset — skipping Booking relation.");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (notion.dataSources.update as any)({ data_source_id: ds, properties });

  console.log("Expert Feedback data source configured.");
  console.log("NOTION_DEV_EXPERT_FEEDBACK_DB_ID=" + DB_ID);
  console.log("NOTION_DEV_EXPERT_FEEDBACK_DATA_SOURCE_ID=" + ds);
}

main().catch((e) => { console.error(e); process.exit(1); });
