/**
 * Backfill slack_channels.channel_id for rows that have a channel name but no id,
 * resolving via the Slack API. Idempotent; safe to re-run.
 *   npm run backfill:slack-ids
 */
import { listSlackChannels, setSlackChannelId } from "../lib/db/slack";
import { lookupChannelIdByName } from "../lib/slack/api";

async function main() {
  const rows = await listSlackChannels();
  const missing = rows.filter((r) => !r.channelId && r.channelName);
  const noName = rows.filter((r) => !r.channelName).length;
  console.log(`${rows.length} channels; ${missing.length} missing an id${noName ? `; ${noName} have no name (skipped)` : ""}.`);

  let resolved = 0;
  for (const r of missing) {
    const id = await lookupChannelIdByName(r.channelName);
    if (id) {
      await setSlackChannelId(r.city, id);
      resolved++;
      console.log(`  ✓ ${r.city}: ${r.channelName} → ${id}`);
    } else {
      console.log(`  ✗ ${r.city}: ${r.channelName} → not resolved`);
    }
  }

  console.log(`\nResolved ${resolved}/${missing.length}.`);
  if (missing.length > 0 && resolved === 0) {
    console.log(
      "Resolved 0 — the Slack app likely lacks `channels:read` (and `groups:read` " +
      "for private channels). Add the scope(s), reinstall the app, and re-run.",
    );
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
