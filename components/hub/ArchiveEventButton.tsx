"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Archive (hide) or un-archive an event's dashboard. Hiding asks for confirmation
 * (it removes the dashboard everywhere + the public embed and makes the event inert
 * in the crons); un-archiving is immediate. Reversible either way.
 */
export function ArchiveEventButton({
  lumaEventId,
  hidden,
  label,
}: {
  lumaEventId: string;
  hidden: boolean; // current state: true = currently archived (button un-archives)
  label?: string; // event label, shown in the confirm prompt
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !hidden;
    if (next && !confirm(`Archive the dashboard for "${label ?? "this event"}"? It disappears from all dashboards and its public embed, and stops the background syncs. You can un-archive it later.`)) {
      return;
    }
    setBusy(true);
    await fetch("/api/hub/events/hide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lumaEventId, hidden: next }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${
        hidden
          ? "border-line bg-white text-neutral-600 hover:bg-neutral-50"
          : "border-red-200 bg-white text-red-600 hover:bg-red-50"
      }`}
    >
      {busy ? "…" : hidden ? "Un-archive" : "Archive dashboard"}
    </button>
  );
}
