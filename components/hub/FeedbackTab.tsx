"use client";

import { useState } from "react";
import type { HubFeedback } from "@/lib/hub/queries";
import type { Chip } from "@/lib/hub/format";

const COLS = 10;

export function FeedbackTab({ feedback, chips }: { feedback: HubFeedback[]; chips: Chip[] }) {
  const [chip, setChip] = useState("all");
  const [search, setSearch] = useState("");
  const allChips: Chip[] = [{ key: "all", label: "All feedback" }, ...chips];

  const q = search.trim().toLowerCase();
  const rows = feedback.filter((f) => {
    if (chip !== "all" && f.luma_event_id !== chip) return false;
    if (!q) return true;
    return (
      (f.guest_name ?? "").toLowerCase().includes(q) ||
      (f.highlight ?? "").toLowerCase().includes(q) ||
      (f.notion_expert ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {allChips.map((c) => (
          <button
            key={c.key}
            onClick={() => setChip(c.key)}
            className={`rounded-full border px-3 py-1 text-sm ${chip === c.key ? "border-neutral-800 bg-neutral-900 text-white" : "border-line bg-white text-neutral-700 hover:bg-neutral-50"}`}
          >
            {c.label}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, comment, expert"
          className="ml-auto w-64 rounded-md border border-line bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wide text-neutral-400">
            <tr>
              {["Name", "Event", "Satisfaction", "Confidence", "Interests", "Will try", "Highlight / improve", "Notion Expert", "Review?", "Submitted"].map((h) => (
                <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id} className="border-b border-line align-top last:border-0">
                <td className="whitespace-nowrap px-3 py-2 font-medium text-neutral-800">{f.guest_name ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-neutral-600">{f.event_name ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-neutral-600">
                  {f.satisfaction_score != null ? (
                    <span className="font-semibold text-neutral-800">{f.satisfaction_score}</span>
                  ) : "—"}
                  {f.satisfaction_label ? <span className="ml-1 text-neutral-400">{f.satisfaction_label}</span> : null}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-neutral-600">{f.confidence ?? "—"}</td>
                <td className="max-w-[220px] px-3 py-2 text-neutral-600">{f.interests.length ? f.interests.join(", ") : "—"}</td>
                <td className="max-w-[220px] truncate px-3 py-2 text-neutral-600" title={f.feature_intent ?? ""}>{f.feature_intent ?? "—"}</td>
                <td className="max-w-[320px] px-3 py-2 text-neutral-600">{f.highlight ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-neutral-600">{f.notion_expert ?? "—"}</td>
                <td className="px-3 py-2">
                  {f.needs_review ? (
                    <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Review</span>
                  ) : (
                    <span className="text-neutral-300">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-neutral-500">{f.submitted_at ? f.submitted_at.slice(0, 10) : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={COLS} className="px-3 py-6 text-center text-neutral-400">No feedback yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
