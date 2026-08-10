// scripts/configure-expert-feedback-db.ts
// Run once: sets the Dev "Expert Feedback" DB schema to match the mapper and
// prints its data-source id for NOTION_DEV_EXPERT_FEEDBACK_DATA_SOURCE_ID.
// Usage: npm run setup:expert-feedback
import { Client } from "@notionhq/client";

const DB_ID = process.env.NOTION_DEV_EXPERT_FEEDBACK_DB_ID ?? "3b5b35e6e67f803d9b44e89ebcfa6daa";

async function main() {
  const token = process.env.NOTION_DEV_TOKEN;
  if (!token) throw new Error("NOTION_DEV_TOKEN missing");
  const notion = new Client({ auth: token });

  // The mapper writes these; the title property already exists (rename via update).
  const properties: Record<string, unknown> = {
    "Expert": { title: {} },
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
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (notion.databases.update as any)({ database_id: DB_ID, properties });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (await notion.databases.retrieve({ database_id: DB_ID })) as any;
  const ds = db.data_sources?.[0]?.id ?? "(none — check API version / sharing)";
  console.log("Expert Feedback DB configured.");
  console.log("NOTION_DEV_EXPERT_FEEDBACK_DB_ID=" + DB_ID);
  console.log("NOTION_DEV_EXPERT_FEEDBACK_DATA_SOURCE_ID=" + ds);
}

main().catch((e) => { console.error(e); process.exit(1); });
