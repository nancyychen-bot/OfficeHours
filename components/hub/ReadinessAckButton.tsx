"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** "Mark complete" toggle for an event on the readiness page. */
export function ReadinessAckButton({ lumaEventId, acked }: { lumaEventId: string | null; acked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!lumaEventId) return null;

  async function toggle() {
    setBusy(true);
    await fetch("/api/hub/readiness/ack", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lumaEventId, done: !acked }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${
        acked
          ? "border-green-300 bg-green-100 text-green-800 hover:bg-green-200"
          : "border-line bg-white text-neutral-600 hover:bg-neutral-50"
      }`}
    >
      {busy ? "…" : acked ? "✓ Completed — undo" : "Mark complete"}
    </button>
  );
}
