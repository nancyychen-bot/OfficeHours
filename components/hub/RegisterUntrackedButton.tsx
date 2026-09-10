"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** "Register & backfill" a single untracked event, or all of them (eventId omitted). */
export function RegisterUntrackedButton({ eventId, label }: { eventId?: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/hub/readiness/register-untracked", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(eventId ? { eventId } : {}),
      });
      const data = (await res.json()) as { registered?: number; total?: number; results?: { ok: boolean; error?: string; importedGuests?: number }[] };
      const guests = (data.results ?? []).reduce((n, r) => n + (r.importedGuests ?? 0), 0);
      const failed = (data.results ?? []).find((r) => !r.ok);
      setMsg(res.ok ? `Registered ${data.registered}/${data.total}, ${guests} guest(s) imported${failed ? ` — some failed: ${failed.error}` : ""}` : "Failed");
    } catch {
      setMsg("Failed — try again");
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={run}
        disabled={busy}
        className="shrink-0 rounded-md bg-neutral-900 px-2 py-0.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy ? "Registering…" : label}
      </button>
      {msg ? <span className="text-xs text-neutral-600">{msg}</span> : null}
    </span>
  );
}
