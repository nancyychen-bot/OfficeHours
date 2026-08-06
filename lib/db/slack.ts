import { getAdminClient } from "../supabase/admin";

export interface SlackChannel {
  webhookUrl: string;
  channelName: string | null;
}

/**
 * The Slack incoming webhook for a city's #build-bar channel, or null if none is
 * configured. An event's city (from Luma's geocoded address) is matched
 * case-insensitively against each channel's `city` OR any of its `aliases` — so a
 * Brooklyn/Manhattan venue still routes to the NYC channel. The table is tiny
 * (one row per city), so we fetch all and match in code for flexibility. The
 * webhook URL is a secret — only read here via the service-role client.
 */
export async function getSlackChannelForCity(city: string | null | undefined): Promise<SlackChannel | null> {
  const needle = (city ?? "").trim().toLowerCase();
  if (!needle) return null;
  const supabase = getAdminClient();
  const { data } = await supabase.from("slack_channels").select("webhook_url, channel_name, city, aliases");
  const match = (data ?? []).find((row) => {
    const names = [row.city, ...(row.aliases ?? [])].map((n) => (n ?? "").trim().toLowerCase());
    return names.includes(needle);
  });
  if (!match?.webhook_url) return null;
  return { webhookUrl: match.webhook_url, channelName: match.channel_name };
}
