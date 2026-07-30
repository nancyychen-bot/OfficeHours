import { Client } from "@notionhq/client";
import { env } from "../env";

export type NotionWorkspace = "dev" | "ambassador";

/**
 * One Notion client per workspace. Integration tokens are workspace-scoped and
 * never cross workspaces (PRD §6.3 / §7.3) — so the hub holds two tokens and
 * brokers between them. The SDK (v5) pins a data-source-aware API version.
 */
export function getNotionClient(workspace: NotionWorkspace): Client {
  const token = workspace === "dev" ? env.notionDev.token() : env.notionAmbassador.token();
  return new Client({ auth: token });
}

/** The Bookings data-source id for a workspace (rows live on the data source, v2025-09-03+). */
export function bookingsDataSourceId(workspace: NotionWorkspace): string {
  return workspace === "dev"
    ? env.notionDev.bookingsDataSourceId()
    : env.notionAmbassador.bookingsDataSourceId();
}
