import Link from "next/link";
import type { HubEvent } from "@/lib/hub/queries";

export function EventsTab({ events }: { events: HubEvent[] }) {
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Link
          href="/add-event"
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
        >
          New event
        </Link>
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wide text-neutral-400">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">City</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Luma id</th>
              <th className="px-3 py-2 font-medium">Slots</th>
              <th className="px-3 py-2 font-medium">Bookings</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-b border-line last:border-0">
                <td className="px-3 py-2 font-medium text-neutral-800">{e.name}</td>
                <td className="px-3 py-2 text-neutral-600">{e.city ?? "—"}</td>
                <td className="px-3 py-2 text-neutral-600">{e.event_date ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs text-neutral-500">{e.luma_event_id}</td>
                <td className="px-3 py-2 text-neutral-600">{e.slot_count}</td>
                <td className="px-3 py-2 text-neutral-600">{e.booking_count}</td>
                <td className="px-3 py-2 text-neutral-600">{e.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
