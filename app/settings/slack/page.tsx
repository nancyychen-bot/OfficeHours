import { HubNav } from "@/components/hub/HubNav";
import { SettingsNav } from "@/components/hub/SettingsNav";
import { SlackManager, type ChannelView } from "@/components/hub/SlackManager";
import { listSlackChannels } from "@/lib/db/slack";

export const dynamic = "force-dynamic";

/** Show only a short tail of the secret webhook — never the full URL to the browser. */
function mask(url: string): string {
  const tail = url.slice(-6);
  return `https://hooks.slack.com/…${tail}`;
}

export default async function SettingsSlackPage() {
  const rows = await listSlackChannels();
  const channels: ChannelView[] = rows.map((r) => ({
    city: r.city,
    channelName: r.channelName,
    aliases: r.aliases,
    webhookMasked: mask(r.webhookUrl),
  }));
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <HubNav />
      <SettingsNav />
      <p className="mb-5 max-w-2xl text-sm text-neutral-500">
        Manage the per-city Slack channels the hub posts to when a 1:1 slot opens up. Add a new city’s webhook here —
        no code or SQL needed.
      </p>
      <SlackManager channels={channels} />
    </main>
  );
}
