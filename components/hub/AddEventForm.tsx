"use client";

import { useState } from "react";

type Result =
  | { ok: true; warning?: string; event: { name: string; slots: number; importedGuests: number } }
  | { ok: false; needsCalendar?: boolean; error: string };

export function AddEventForm({ token, webhookUrl }: { token: string; webhookUrl: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [needsCalendar, setNeedsCalendar] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const body = new FormData(e.currentTarget);
    const res = await fetch("/api/hub/add-event", { method: "POST", body });
    const data = (await res.json()) as Result;
    setResult(data);
    if (!data.ok && data.needsCalendar) setNeedsCalendar(true);
    setBusy(false);
  }

  const field = "w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400";

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3">
      <input type="hidden" name="token" value={token} />
      <label className="block text-sm">
        <span className="text-neutral-600">Luma event URL or id *</span>
        <input name="lumaEvent" required placeholder="https://lu.ma/..." className={`mt-1 ${field}`} />
      </label>
      <label className="block text-sm">
        <span className="text-neutral-600">Slack channel *</span>
        <input name="slackChannel" required placeholder="#build-bar-nyc" className={`mt-1 ${field}`} />
      </label>
      {needsCalendar ? (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-900">Connect this Luma calendar (one-time)</p>
          <p className="text-amber-800">
            We don&apos;t have an API key for this event&apos;s calendar yet. In Luma, open the calendar →{" "}
            <strong>Settings → Options → Luma API</strong>, copy the <code>secret-…</code> key, and paste it below.
          </p>
          <p className="text-amber-800">
            <strong>Live guest sync:</strong> on that same Luma API page, add a webhook pointing to{" "}
            <code className="break-all rounded bg-amber-100 px-1 py-0.5">{webhookUrl}</code>, then paste the signing
            secret it gives you into the Webhook signing secret field below.
          </p>
          <p className="font-semibold text-amber-900">Ask Nancy Chen to help you if you&apos;re stuck here.</p>
          <input name="calendarApiKey" required placeholder="secret-… (Luma API key)" className={field} />
          <input name="calendarWebhookSecret" required placeholder="Webhook signing secret" className={field} />
          <input name="calendarUrl" required placeholder="Luma calendar URL (e.g. https://luma.com/notion-korea)" className={field} />
          <input name="calendarSlug" required placeholder="Short id / location for this calendar (e.g. london or korea)" className={field} />
        </div>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add event"}
      </button>
      {result?.ok ? (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Added <strong>{result.event.name}</strong> — {result.event.slots} slots tracked
          {result.event.importedGuests > 0
            ? `, ${result.event.importedGuests} existing guest${result.event.importedGuests === 1 ? "" : "s"} imported`
            : ""}
          .
        </p>
      ) : null}
      {result?.ok && result.warning ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">⚠️ {result.warning}</p>
      ) : null}
      {result && !result.ok ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{result.error}</p>
      ) : null}
    </form>
  );
}
