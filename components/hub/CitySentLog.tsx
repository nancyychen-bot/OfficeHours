"use client";

import { useState } from "react";
import type { SentLogRow } from "@/lib/comms/log";

const statusClass: Record<string, string> = {
  sent: "bg-green-50 text-green-700",
  failed: "bg-red-50 text-red-700",
  skipped: "bg-neutral-100 text-neutral-500",
  pending: "bg-amber-50 text-amber-700",
};

export function CitySentLog({ rows }: { rows: SentLogRow[] }) {
  const [filter, setFilter] = useState<"all" | "guest" | "expert" | "failed">("all");
  const [open, setOpen] = useState<number | null>(null);
  const [content, setContent] = useState<{ subject: string; html: string } | null>(null);

  const shown = rows.filter((r) =>
    filter === "all" ? true : filter === "failed" ? r.status === "failed" : filter === "guest" ? r.role === "guest" : r.role === "helper",
  );

  async function toggle(i: number, r: SentLogRow) {
    if (open === i) { setOpen(null); return; }
    setOpen(i); setContent(null);
    const res = await fetch(`/api/hub/sent-email?kind=${r.kind}&role=${r.role}`);
    setContent(res.ok ? await res.json() : null);
  }

  if (!rows.length) return <div className="rounded-xl border border-line p-6 text-center text-sm text-neutral-400">No emails sent for this city yet.</div>;

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="flex items-center gap-2 border-b border-line bg-neutral-50 px-4 py-2 text-xs">
        <strong>Sent emails</strong><span className="text-neutral-400">{rows.length} total</span>
        <span className="ml-auto flex gap-1">
          {(["all", "guest", "expert", "failed"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-2.5 py-0.5 ${filter === f ? "bg-neutral-900 text-white" : "border border-line text-neutral-600"}`}>{f}</button>
          ))}
        </span>
      </div>
      <div className="max-h-[520px] overflow-y-auto text-sm">
        {shown.map((r, i) => (
          <div key={i} className="border-b border-line last:border-0">
            <button onClick={() => toggle(i, r)} className="grid w-full grid-cols-[150px_1fr_160px_80px] items-center gap-3 px-4 py-2 text-left hover:bg-neutral-50">
              <span className="text-neutral-500">{new Date(r.when).toLocaleString()}</span>
              <span><span className="mr-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-600">{r.category}</span></span>
              <span className="truncate text-neutral-600">{r.guestName ?? r.recipientEmail ?? "—"}</span>
              <span className={`justify-self-start rounded-full px-2 py-0.5 text-[11px] ${statusClass[r.status] ?? "bg-neutral-100"}`}>{r.status}</span>
            </button>
            {open === i ? (
              <div className="mx-4 mb-3 overflow-hidden rounded-lg border border-line bg-white">
                <div className="border-b border-line bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500">
                  to {r.recipientEmail ?? "—"} · {new Date(r.when).toLocaleString()} · {r.status}
                </div>
                <div className="px-4 py-3 text-sm">
                  {content ? (
                    <>
                      <div className="text-[10px] uppercase text-neutral-400">Subject</div>
                      <div className="mb-2">{content.subject}</div>
                      <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: content.html }} />
                      <div className="mt-2 text-[11px] text-neutral-400">template content shown (exact sent HTML persisted in a later phase)</div>
                    </>
                  ) : <div className="text-neutral-400">Loading…</div>}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
