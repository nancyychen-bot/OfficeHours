"use client";

import { useMemo, useState } from "react";
import { EventInstructionsEditor } from "@/components/hub/EventInstructionsEditor";

export interface InstructionsEvent {
  lumaEventId: string | null;
  name: string;
  city: string | null;
  eventDate: string;
  prepInstructions: string | null;
}

/** Focused editor for per-event prep-email instructions, one row per upcoming
 * event. Search + "missing only" make it easy to find the event to change. */
export function EventInstructionsManager({ events }: { events: InstructionsEvent[] }) {
  const [q, setQ] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events.filter((e) => {
      if (missingOnly && (e.prepInstructions ?? "").trim()) return false;
      if (!needle) return true;
      return `${e.name} ${e.city ?? ""}`.toLowerCase().includes(needle);
    });
  }, [events, q, missingOnly]);

  const withCount = events.filter((e) => (e.prepInstructions ?? "").trim()).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by event or city…"
          className="w-64 rounded border border-line px-2 py-1 text-sm"
        />
        <label className="flex items-center gap-1.5 text-sm text-neutral-600">
          <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} />
          Only events without instructions
        </label>
        <span className="ml-auto text-xs text-neutral-500">
          {withCount} of {events.length} upcoming event{events.length === 1 ? "" : "s"} have instructions
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-neutral-500">No matching events.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((e, n) => {
            const has = !!(e.prepInstructions ?? "").trim();
            return (
              <div key={e.lumaEventId ?? n} className="rounded-md border border-line px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{e.name}</span>
                  <span className="text-sm text-neutral-500">— {e.city ?? "no city"} · {formatDate(e.eventDate)}</span>
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${
                      has ? "bg-green-100 text-green-800" : "bg-neutral-100 text-neutral-500"
                    }`}
                  >
                    {has ? "✓ has instructions" : "none set"}
                  </span>
                </div>
                {e.lumaEventId ? (
                  <EventInstructionsEditor lumaEventId={e.lumaEventId} initial={e.prepInstructions} />
                ) : (
                  <p className="mt-2 text-xs text-amber-700">No Luma event id — can&apos;t attach instructions to this event.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** "Mon, Sep 22" from a YYYY-MM-DD (parsed as UTC to avoid TZ off-by-one). */
function formatDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
