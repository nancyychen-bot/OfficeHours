"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ChannelView {
  city: string;
  channelName: string | null;
  aliases: string[];
  webhookMasked: string;
}

export function SlackManager({ channels }: { channels: ChannelView[] }) {
  const router = useRouter();
  const [city, setCity] = useState("");
  const [channelName, setChannelName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [aliases, setAliases] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function post(action: string, payload: Record<string, string>) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/hub/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      return true;
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const ok = await post("save", { city, channelName, webhookUrl, aliases });
    if (ok) {
      setMsg({ kind: "ok", text: `Saved ${city}.` });
      setCity(""); setChannelName(""); setWebhookUrl(""); setAliases("");
      router.refresh();
    }
  }

  async function remove(c: string) {
    if (!confirm(`Remove the Slack channel for ${c}? Openings in ${c} will stop posting.`)) return;
    if (await post("delete", { city: c })) router.refresh();
  }

  return (
    <div className="space-y-8">
      {/* How-to */}
      <section className="rounded-lg border border-line bg-white p-5">
        <h2 className="mb-2 text-lg font-semibold">Add a webhook for a new city</h2>
        <p className="mb-3 text-sm text-neutral-500">
          When a 1:1 slot opens up (a Notion expert unclaims), the hub posts a “can anyone cover this?” message to that
          city’s Slack channel — with buttons to the ambassador and Notino cards. Each city needs its own channel and its
          own incoming webhook. You reuse one Slack app; you just add a webhook per channel.
        </p>
        <ol className="ml-5 list-decimal space-y-1.5 text-sm text-neutral-700">
          <li>
            Open{" "}
            <a className="font-medium text-blue-600 underline" href="https://api.slack.com/apps" target="_blank" rel="noreferrer">
              api.slack.com/apps
            </a>{" "}
            and pick your Build Bar app (or <span className="font-medium">Create New App → From scratch</span>, name it, choose the workspace — this may need IT approval).
          </li>
          <li>In the left sidebar choose <span className="font-medium">Incoming Webhooks</span> and toggle it <span className="font-medium">On</span>.</li>
          <li>Scroll down and click <span className="font-medium">Add New Webhook to Workspace</span>.</li>
          <li>Pick the city’s channel (e.g. <span className="font-mono text-xs">#build-bar-sf</span>) and click <span className="font-medium">Allow</span>.</li>
          <li>Copy the new <span className="font-medium">Webhook URL</span> (starts with <span className="font-mono text-xs">https://hooks.slack.com/services/…</span>).</li>
          <li>Add it below — City, channel name, the webhook URL, and any aliases.</li>
        </ol>
        <p className="mt-3 text-xs text-neutral-500">
          Reference:{" "}
          <a className="text-blue-600 underline" href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noreferrer">
            Slack incoming webhooks docs
          </a>
        </p>
      </section>

      {/* Existing channels */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Configured cities</h2>
        {channels.length === 0 ? (
          <p className="text-sm text-neutral-500">No cities yet — add one below.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-2 font-medium">City</th>
                  <th className="px-4 py-2 font-medium">Channel</th>
                  <th className="px-4 py-2 font-medium">Also matches</th>
                  <th className="px-4 py-2 font-medium">Webhook</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {channels.map((c) => (
                  <tr key={c.city}>
                    <td className="px-4 py-2 font-medium">{c.city}</td>
                    <td className="px-4 py-2 text-neutral-600">{c.channelName ?? "—"}</td>
                    <td className="px-4 py-2 text-neutral-600">{c.aliases.length ? c.aliases.join(", ") : "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs text-neutral-500">{c.webhookMasked}</td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => remove(c.city)} disabled={busy} className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Add / replace form */}
      <section className="rounded-lg border border-line bg-white p-5">
        <h2 className="mb-1 text-lg font-semibold">Add or replace a city</h2>
        <p className="mb-4 text-xs text-neutral-500">Saving a city that already exists replaces its webhook and aliases.</p>
        <form onSubmit={save} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-neutral-700">City</span>
              <input value={city} onChange={(e) => setCity(e.target.value)} required placeholder="San Francisco"
                className="w-full rounded-md border border-line px-3 py-1.5" />
              <span className="mt-1 block text-xs text-neutral-400">Must match the event’s City (from Luma’s address).</span>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-neutral-700">Channel name</span>
              <input value={channelName} onChange={(e) => setChannelName(e.target.value)} placeholder="#build-bar-sf"
                className="w-full rounded-md border border-line px-3 py-1.5" />
              <span className="mt-1 block text-xs text-neutral-400">Just for your reference in this table.</span>
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-neutral-700">Webhook URL</span>
            <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} required placeholder="https://hooks.slack.com/services/…"
              className="w-full rounded-md border border-line px-3 py-1.5 font-mono text-xs" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-neutral-700">Aliases (optional)</span>
            <input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="SF, San Fran, Oakland"
              className="w-full rounded-md border border-line px-3 py-1.5" />
            <span className="mt-1 block text-xs text-neutral-400">Comma-separated. Other names the city might arrive as (e.g. boroughs, abbreviations).</span>
          </label>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy} className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
              {busy ? "Saving…" : "Save city"}
            </button>
            {msg && <span className={`text-sm ${msg.kind === "ok" ? "text-green-600" : "text-red-600"}`}>{msg.text}</span>}
          </div>
        </form>
      </section>
    </div>
  );
}
