import type { ArchivedEvent } from "@/lib/hub/queries";
import { ArchiveEventButton } from "./ArchiveEventButton";

/** Collapsible list of operator-archived dashboards, with an un-archive control.
 * Renders nothing when there's nothing archived. Non-Build-Bar events hidden by
 * name (not explicitly archived) don't appear here — only the `hidden` flag does. */
export function ArchivedEvents({ archived }: { archived: ArchivedEvent[] }) {
  if (!archived.length) return null;
  return (
    <details className="mt-8 rounded-xl border border-line bg-neutral-50 p-4">
      <summary className="cursor-pointer text-sm font-medium text-neutral-600">
        Archived dashboards ({archived.length})
      </summary>
      <ul className="mt-3 space-y-1.5">
        {archived.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-3 border-b border-line py-1.5 text-sm last:border-0">
            <span className="text-neutral-700">
              {e.name}
              <span className="ml-2 text-neutral-400">
                {e.city ?? "—"}
                {e.event_date ? ` · ${e.event_date}` : ""}
              </span>
            </span>
            <ArchiveEventButton lumaEventId={e.luma_event_id} hidden label={e.name} />
          </li>
        ))}
      </ul>
    </details>
  );
}
