import type { HubBooking, HubEvent } from "./queries";

const STATUS_PILLS: Record<string, { label: string; className: string }> = {
  unassigned: { label: "Unassigned", className: "bg-neutral-100 text-neutral-600" },
  assigned: { label: "Assigned", className: "bg-blue-100 text-blue-800" },
  checked_in: { label: "Checked In", className: "bg-green-100 text-green-800" },
  no_show: { label: "No-show", className: "bg-amber-100 text-amber-800" },
  cancelled: { label: "Cancelled", className: "bg-red-100 text-red-700" },
};

export function statusPill(status: string): { label: string; className: string } {
  return STATUS_PILLS[status] ?? { label: status, className: "bg-neutral-100 text-neutral-600" };
}

/** The booking statuses available as filter chips, in display order. */
export const STATUS_FILTERS: { value: string; label: string }[] = [
  "unassigned",
  "assigned",
  "checked_in",
  "no_show",
  "cancelled",
].map((value) => ({ value, label: STATUS_PILLS[value].label }));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08-26" -> "Aug 2026". Empty string for null. */
export function monthLabel(dateISO: string | null): string {
  if (!dateISO) return "";
  const [y, m] = dateISO.split("-");
  const mi = Number(m) - 1;
  if (!y || mi < 0 || mi > 11) return "";
  return `${MONTHS[mi]} ${y}`;
}

export interface Chip {
  key: string;
  label: string;
}

/** One chip per event, keyed by luma_event_id, labelled "City — Mon Year". */
export function eventChips(events: HubEvent[]): Chip[] {
  return events.map((e) => ({
    key: e.luma_event_id,
    label: `${e.city ?? "—"} — ${monthLabel(e.event_date)}`.replace(/ — $/, ""),
  }));
}

/**
 * Filter by event chip ("all" = no filter), then by selected statuses
 * (empty/undefined = all), then by a name/company/email search. All AND-combined.
 */
export function filterBookings(
  rows: HubBooking[],
  opts: { chip: string; search: string; statuses?: string[] },
): HubBooking[] {
  const q = opts.search.trim().toLowerCase();
  const statuses = opts.statuses ?? [];
  return rows.filter((r) => {
    if (opts.chip !== "all" && r.luma_event_id !== opts.chip) return false;
    if (statuses.length && !statuses.includes(r.status)) return false;
    if (!q) return true;
    return (
      r.guest_name.toLowerCase().includes(q) ||
      (r.company ?? "").toLowerCase().includes(q) ||
      (r.guest_email ?? "").toLowerCase().includes(q)
    );
  });
}

export interface CityGroup {
  city: string;
  rows: HubBooking[];
}

/** Group bookings by location, preserving first-seen city order. */
export function groupByCity(rows: HubBooking[]): CityGroup[] {
  const order: string[] = [];
  const map = new Map<string, HubBooking[]>();
  for (const r of rows) {
    const city = r.location ?? "—";
    if (!map.has(city)) {
      map.set(city, []);
      order.push(city);
    }
    map.get(city)!.push(r);
  }
  return order.map((city) => ({ city, rows: map.get(city)! }));
}

/** Compact "2 min ago" / "2 hr ago" / "3 days ago"; "never" for null. */
export function relativeTime(iso: string | null, nowMs: number): string {
  if (!iso) return "never";
  const diff = nowMs - Date.parse(iso);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
