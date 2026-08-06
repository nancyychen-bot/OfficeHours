/**
 * Make the Dev feedback DB schema identical to the Ambassador one (canonical),
 * and add the backend-managed properties to both. Idempotent.
 *
 * Run: npx tsx --env-file=.env.local scripts/sync-feedback-schema.ts
 *
 * - Rewrites Dev's select/multi-select OPTIONS to match Ambassador's exactly.
 * - Adds "Needs review" (checkbox) + "Satisfaction score" (number) to BOTH.
 */
import { getNotionClient } from "../lib/notion/client";
import { FB, FEEDBACK_AMBASSADOR_DS, FEEDBACK_DEV_DS } from "../lib/notion/feedback";

// Select / multi-select properties whose options should match Ambassador.
const OPTION_PROPS = [
  FB.satisfaction,
  "How confident are you using Notion after this event vs. before?",
  "Would you be interested in any of these?",
  FB.location,
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function retrieveDS(client: ReturnType<typeof getNotionClient>, id: string): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await (client as any).dataSources.retrieve({ data_source_id: id })) as any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function updateDS(client: ReturnType<typeof getNotionClient>, id: string, properties: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client as any).dataSources.update({ data_source_id: id, properties });
}

async function main() {
  const amb = getNotionClient("ambassador");
  const dev = getNotionClient("dev");

  const ambSrc = await retrieveDS(amb, FEEDBACK_AMBASSADOR_DS);
  const devSrc = await retrieveDS(dev, FEEDBACK_DEV_DS);
  const ambProps = ambSrc.properties ?? {};
  const devProps = devSrc.properties ?? {};

  // 1) Align Dev's option sets to Ambassador's (names only; Notion assigns colors).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const devUpdate: any = {};
  for (const name of OPTION_PROPS) {
    const a = ambProps[name];
    const d = devProps[name];
    if (!a || !d) {
      console.log(`  skip "${name}" — missing on ${!a ? "Ambassador" : "Dev"}`);
      continue;
    }
    const type = a.type as "select" | "multi_select";
    const options = (a[type]?.options ?? []).map((o: { name: string }) => ({ name: o.name }));
    devUpdate[name] = { [type]: { options } };
  }
  if (Object.keys(devUpdate).length) {
    await updateDS(dev, FEEDBACK_DEV_DS, devUpdate);
    console.log(`[dev] aligned options for: ${Object.keys(devUpdate).join(", ")}`);
  }

  // 2) Ensure Needs review (checkbox) + Satisfaction score (number) on BOTH.
  const additions: Record<string, { checkbox: object } | { number: object }> = {
    [FB.needsReview]: { checkbox: {} },
    [FB.satisfactionScore]: { number: {} },
  };
  for (const [label, id, props] of [
    ["ambassador", FEEDBACK_AMBASSADOR_DS, ambProps],
    ["dev", FEEDBACK_DEV_DS, devProps],
  ] as const) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const missing: any = {};
    for (const [name, def] of Object.entries(additions)) {
      if (!props[name]) missing[name] = def;
    }
    if (Object.keys(missing).length) {
      await updateDS(label === "ambassador" ? amb : dev, id, missing);
      console.log(`[${label}] added: ${Object.keys(missing).join(", ")}`);
    } else {
      console.log(`[${label}] Needs review + Satisfaction score already present`);
    }
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
