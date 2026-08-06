/**
 * One-off: archive ALL booking cards in both Notion workspaces (Dev + Ambassador)
 * so they match a freshly-reset Supabase. Idempotent — re-running skips already
 * archived pages. Run: npx tsx scripts/archive-all-cards.ts
 */
import { getNotionClient, bookingsDataSourceId, type NotionWorkspace } from "../lib/notion/client";

async function archiveWorkspace(workspace: NotionWorkspace): Promise<void> {
  let notion: ReturnType<typeof getNotionClient>;
  let dsId: string;
  try {
    notion = getNotionClient(workspace);
    dsId = bookingsDataSourceId(workspace);
  } catch {
    console.log(`[${workspace}] not configured — skipping`);
    return;
  }

  let archived = 0;
  let cursor: string | undefined;
  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = (await (notion as any).dataSources.query({
      data_source_id: dsId,
      start_cursor: cursor,
      page_size: 100,
    })) as { results: Array<{ id: string; archived?: boolean; in_trash?: boolean }>; has_more: boolean; next_cursor: string | null };

    for (const page of res.results) {
      if (page.archived || page.in_trash) continue;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (notion as any).pages.update({ page_id: page.id, archived: true });
        archived++;
      } catch (err) {
        console.error(`[${workspace}] failed to archive ${page.id}:`, err instanceof Error ? err.message : err);
      }
    }
    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);

  console.log(`[${workspace}] archived ${archived} card(s)`);
}

async function main() {
  for (const ws of ["dev", "ambassador"] as const) {
    await archiveWorkspace(ws);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
