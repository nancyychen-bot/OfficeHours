"use client";

import { useState } from "react";
import type { HubBooking } from "@/lib/hub/queries";
import { filterBookings, groupByCity, STATUS_FILTERS, type Chip } from "@/lib/hub/format";
import { StatusPill } from "./StatusPill";

export function BookingsTab({ bookings, chips }: { bookings: HubBooking[]; chips: Chip[] }) {
  const [chip, setChip] = useState("all");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const groups = groupByCity(filterBookings(bookings, { chip, search, statuses }));
  const allChips: Chip[] = [{ key: "all", label: "All bookings" }, ...chips];

  function toggleStatus(value: string) {
    setStatuses((prev) => (prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]));
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
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
          placeholder="Search name, company, email"
          className="ml-auto w-64 rounded-md border border-line bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-neutral-400">Status</span>
        {STATUS_FILTERS.map((s) => {
          const active = statuses.includes(s.value);
          return (
            <button
              key={s.value}
              onClick={() => toggleStatus(s.value)}
              className={`rounded-full border px-3 py-1 text-xs ${active ? "border-neutral-800 bg-neutral-900 text-white" : "border-line bg-white text-neutral-600 hover:bg-neutral-50"}`}
            >
              {s.label}
            </button>
          );
        })}
        {statuses.length > 0 ? (
          <button onClick={() => setStatuses([])} className="text-xs text-neutral-500 underline hover:text-neutral-800">
            Clear
          </button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wide text-neutral-400">
            <tr>
              <th className="px-3 py-2 font-medium">Guest</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Slot</th>
              <th className="px-3 py-2 font-medium">City</th>
              <th className="px-3 py-2 font-medium">Booked by</th>
              <th className="px-3 py-2 font-medium">Helper type</th>
              <th className="px-3 py-2 font-medium">Challenge</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <RowsForCity key={g.city} city={g.city} rows={g.rows} />
            ))}
            {groups.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-neutral-400">
                  No bookings match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowsForCity({ city, rows }: { city: string; rows: HubBooking[] }) {
  return (
    <>
      <tr className="bg-neutral-50/60">
        <td colSpan={7} className="px-3 py-1.5 text-xs font-semibold text-neutral-500">
          {city} · {rows.length}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.id} className="border-b border-line last:border-0">
          <td className="px-3 py-2 font-medium text-neutral-800">{r.guest_name}</td>
          <td className="px-3 py-2"><StatusPill status={r.status} /></td>
          <td className="px-3 py-2 text-neutral-600">{r.slot_name ?? "—"}</td>
          <td className="px-3 py-2 text-neutral-600">{r.location ?? "—"}</td>
          <td className="px-3 py-2 text-neutral-600">{r.booked_by_display_name ?? "Empty"}</td>
          <td className="px-3 py-2 text-neutral-600">{r.booked_by_type ?? "—"}</td>
          <td className="px-3 py-2 text-neutral-600">{r.challenge ?? "—"}</td>
        </tr>
      ))}
    </>
  );
}
