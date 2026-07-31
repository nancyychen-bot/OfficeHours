import type { SyncSummary } from "@/lib/hub/queries";
import { relativeTime } from "@/lib/hub/format";

export function SyncStrip({ summary, nowMs }: { summary: SyncSummary; nowMs: number }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-white px-4 py-3 text-sm text-neutral-600">
      <span className="inline-block h-2 w-2 rounded-full bg-green-500" aria-hidden />
      <span className="font-medium text-neutral-800">Sync engine</span>
      <span className="text-neutral-400">Hub → Notion Dev → Ambassador</span>
      <span className="ml-auto text-neutral-500">
        Last sync {relativeTime(summary.lastSyncAt, nowMs)} · {summary.trackedEvents} events tracked
      </span>
    </div>
  );
}
