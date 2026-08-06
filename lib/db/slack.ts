import { getAdminClient } from "../supabase/admin";

export interface SlackChannel {
  webhookUrl: string;
  channelName: string | null;
}

/**
 * The Slack incoming webhook for a city's #build-bar channel, or null if none is
 * configured. City is matched case-insensitively against `slack_channels.city`
 * (which should mirror `events.city`). The webhook URL is a secret — only ever
 * read here via the service-role client, never exposed to the browser.
 */
export async function getSlackChannelForCity(city: string | null | undefined): Promise<SlackChannel | null> {
  const c = (city ?? "").trim();
  if (!c) return null;
  const supabase = getAdminClient();
  // `ilike` with no wildcards is a case-insensitive exact match.
  const { data } = await supabase
    .from("slack_channels")
    .select("webhook_url, channel_name")
    .ilike("city", c)
    .maybeSingle();
  if (!data?.webhook_url) return null;
  return { webhookUrl: data.webhook_url, channelName: data.channel_name };
}
