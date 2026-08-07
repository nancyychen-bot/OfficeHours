"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { HubBooking } from "@/lib/hub/queries";
import { filterBookings, groupByCity, lumaStatusPill, STATUS_FILTERS, type Chip } from "@/lib/hub/format";
import { StatusPill } from "./StatusPill";

const COLS = 17;

export function BookingsTab({ bookings, chips }: { bookings: HubBooking[]; chips: Chip[] }) {
  const [chip, setChip] = useState("all");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<HubBooking | null>(null);
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
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <RowsForCity key={g.city} city={g.city} rows={g.rows} onEdit={setEditing} />
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

      {editing ? <EditBookingModal booking={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return <td className="whitespace-nowrap px-3 py-2 text-neutral-600">{children ?? "—"}</td>;
}

function RowsForCity({ city, rows, onEdit }: { city: string; rows: HubBooking[]; onEdit: (b: HubBooking) => void }) {
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
            <td className="px-3 py-2">
              <button onClick={() => onEdit(r)} className="text-xs font-medium text-blue-600 hover:underline">Edit</button>
            </td>
          </tr>
        );
      })}
    </>
  );
}

const FIELDS: Array<{ key: "guest_name" | "role" | "company" | "guest_phone" | "challenge"; label: string; textarea?: boolean }> = [
  { key: "guest_name", label: "Guest name" },
  { key: "role", label: "Role" },
  { key: "company", label: "Company" },
  { key: "guest_phone", label: "Phone" },
  { key: "challenge", label: "Challenge", textarea: true },
];

function EditBookingModal({ booking, onClose }: { booking: HubBooking; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, (booking[f.key] as string | null) ?? ""])),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/hub/bookings/update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: booking.id, ...form }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed.");
      router.refresh();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed."); setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-lg font-semibold">Edit guest info</h3>
        <p className="mb-4 text-xs text-neutral-500">
          Saves to the source of truth and updates both Notion cards. (Status, Booked by, Luma status and slot aren’t edited here.)
        </p>
        <div className="space-y-3">
          {FIELDS.map((f) => (
            <label key={f.key} className="block text-sm">
              <span className="mb-1 block font-medium text-neutral-700">{f.label}</span>
              {f.textarea ? (
                <textarea value={form[f.key]} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  rows={3} className="w-full rounded-md border border-line px-3 py-1.5" />
              ) : (
                <input value={form[f.key]} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  className="w-full rounded-md border border-line px-3 py-1.5" />
              )}
            </label>
          ))}
        </div>
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="rounded-md border border-line px-4 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
