import { getAdminClient } from "../supabase/admin";

export interface SlackChannel {
  webhookUrl: string;
  channelName: string | null;
  channelId: string | null;
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
  const { data } = await supabase.from("slack_channels").select("webhook_url, channel_name, channel_id, city, aliases");
  const match = (data ?? []).find((row) => {
    const names = [row.city, ...(row.aliases ?? [])].map((n) => (n ?? "").trim().toLowerCase());
    return names.includes(needle);
  });
  if (!match) return null;
  return { webhookUrl: match.webhook_url, channelName: match.channel_name, channelId: match.channel_id ?? null };
}

/** Mark that a recruit post went out for this booking (so a later claim can
 * post a "covered" follow-up). Pass null to clear once the follow-up is sent. */
export async function setRecruitPostedAt(bookingId: string, at: string | null): Promise<void> {
  await getAdminClient().from("bookings").update({ slack_recruit_posted_at: at }).eq("id", bookingId);
}

export interface SlackChannelRow {
  city: string;
  channelName: string | null;
  aliases: string[];
  webhookUrl: string;
  channelId: string | null;
}

/** All configured city channels (for the hub management page). */
export async function listSlackChannels(): Promise<SlackChannelRow[]> {
  const { data } = await getAdminClient()
    .from("slack_channels")
    .select("city, channel_name, aliases, webhook_url, channel_id")
    .order("city");
  return (data ?? []).map((r) => ({
    city: r.city,
    channelName: r.channel_name,
    aliases: r.aliases ?? [],
    webhookUrl: r.webhook_url,
    channelId: r.channel_id ?? null,
  }));
}

/** Create or replace a city's channel config (keyed on city). */
export async function upsertSlackChannel(input: {
  city: string;
  channelName: string | null;
  webhookUrl: string;
  aliases: string[];
  channelId: string | null;
}): Promise<void> {
  await getAdminClient()
    .from("slack_channels")
    .upsert(
      {
        city: input.city,
        channel_name: input.channelName,
        webhook_url: input.webhookUrl,
        aliases: input.aliases,
        channel_id: input.channelId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "city" },
    );
}

/** Remove a city's channel config. */
export async function deleteSlackChannel(city: string): Promise<void> {
  await getAdminClient().from("slack_channels").delete().eq("city", city);
}
