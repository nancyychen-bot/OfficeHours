"use client";

import { useState } from "react";

type Result = { ok: true; event: { name: string; slots: number } } | { ok: false; error: string };

export function AddEventForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const body = new FormData(e.currentTarget);
    const res = await fetch("/api/hub/add-event", { method: "POST", body });
    setResult((await res.json()) as Result);
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
      <details className="text-sm">
        <summary className="cursor-pointer text-neutral-500">Optional overrides</summary>
        <div className="mt-2 space-y-2">
          <input name="city" placeholder="City (defaults to Luma address)" className={field} />
          <input name="slotStart" placeholder="First slot start (ISO, e.g. 2026-08-26T21:00:00Z)" className={field} />
          <input name="length" placeholder="Slot length minutes (default 30)" className={field} />
        </div>
      </details>
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add event"}
      </button>
      {result?.ok ? (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Added <strong>{result.event.name}</strong> — {result.event.slots} slots tracked.
        </p>
      ) : null}
      {result && !result.ok ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{result.error}</p>
      ) : null}
    </form>
  );
}
