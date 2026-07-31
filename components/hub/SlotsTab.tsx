import type { HubSlot } from "@/lib/hub/queries";

export function SlotsTab({ slots }: { slots: HubSlot[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line text-xs uppercase tracking-wide text-neutral-400">
          <tr>
            <th className="px-3 py-2 font-medium">Event</th>
            <th className="px-3 py-2 font-medium">City</th>
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Slot</th>
            <th className="px-3 py-2 font-medium">State</th>
            <th className="px-3 py-2 font-medium">Guest</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((s) => (
            <tr key={s.id} className="border-b border-line last:border-0">
              <td className="px-3 py-2 text-neutral-700">{s.event_name ?? "—"}</td>
              <td className="px-3 py-2 text-neutral-600">{s.city ?? "—"}</td>
              <td className="px-3 py-2 text-neutral-600">{s.event_date ?? "—"}</td>
              <td className="px-3 py-2 text-neutral-600">{s.name}</td>
              <td className="px-3 py-2 text-neutral-600">{s.booked ? "Booked" : "Available"}</td>
              <td className="px-3 py-2 text-neutral-600">{s.guest_name ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
