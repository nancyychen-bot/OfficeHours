"use client";

import { useState } from "react";
import type { HubBooking } from "@/lib/hub/queries";
import { filterBookings, groupByCity, lumaStatusPill, STATUS_FILTERS, type Chip } from "@/lib/hub/format";
import { StatusPill } from "./StatusPill";

const COLS = 16;

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

      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wide text-neutral-400">
            <tr>
              {[
                "Guest", "Status", "Luma", "Slot", "Requested", "City", "Booked by", "Type",
                "Role", "Company", "Plan", "Experience", "Reasons", "Notion email", "Phone", "Challenge",
              ].map((h) => (
                <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <RowsForCity key={g.city} city={g.city} rows={g.rows} />
            ))}
            {groups.length === 0 ? (
              <tr>
                <td colSpan={COLS} className="px-3 py-6 text-center text-neutral-400">
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

function Cell({ children }: { children: React.ReactNode }) {
  return <td className="whitespace-nowrap px-3 py-2 text-neutral-600">{children ?? "—"}</td>;
}

function RowsForCity({ city, rows }: { city: string; rows: HubBooking[] }) {
  return (
    <>
      <tr className="bg-neutral-50/60">
        <td colSpan={COLS} className="px-3 py-1.5 text-xs font-semibold text-neutral-500">
          {city} · {rows.length}
        </td>
      </tr>
      {rows.map((r) => {
        const luma = lumaStatusPill(r.luma_status);
        return (
          <tr key={r.id} className="border-b border-line align-top last:border-0">
            <td className="whitespace-nowrap px-3 py-2 font-medium text-neutral-800">{r.guest_name}</td>
            <td className="px-3 py-2"><StatusPill status={r.status} /></td>
            <td className="px-3 py-2">
              <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${luma.className}`}>{luma.label}</span>
            </td>
            <Cell>{r.slot_name}</Cell>
            <Cell>{r.requested_slot}</Cell>
            <Cell>{r.location}</Cell>
            <Cell>{r.booked_by_display_name ?? "Empty"}</Cell>
            <Cell>{r.booked_by_type}</Cell>
            <Cell>{r.role}</Cell>
            <Cell>{r.company}</Cell>
            <Cell>{r.notion_plan}</Cell>
            <Cell>{r.experience_level}</Cell>
            <td className="max-w-[220px] truncate px-3 py-2 text-neutral-600" title={r.attend_reasons ?? ""}>{r.attend_reasons ?? "—"}</td>
            <Cell>{r.notion_email}</Cell>
            <Cell>{r.guest_phone}</Cell>
            <td className="max-w-[320px] px-3 py-2 text-neutral-600">{r.challenge ?? "—"}</td>
          </tr>
        );
      })}
    </>
  );
}
