import { describe, it, expect } from "vitest";
import {
  statusPill,
  monthLabel,
  eventChips,
  filterBookings,
  groupByCity,
  relativeTime,
} from "@/lib/hub/format";
import type { HubBooking, HubEvent } from "@/lib/hub/queries";

function booking(p: Partial<HubBooking>): HubBooking {
  return {
    id: "b1", guest_name: "Ann", guest_email: "a@x.com", company: "Acme", challenge: null,
    status: "unassigned", luma_status: "approved", booked_by_display_name: null, booked_by_type: null,
    booked_by_email: null, location: "SF", event_name: "OH SF", event_date: "2026-08-26", luma_event_id: "evt-1",
    slot_name: "2:00-2:30 PM", slot_starts_at: "2026-08-26T21:00:00Z", requested_slot: null,
    role: null, guest_phone: null, notion_email: null, notion_plan: null, experience_level: null,
    attend_reasons: null, ...p,
  };
}

describe("statusPill", () => {
  it("maps known statuses to labels + classes", () => {
    expect(statusPill("assigned").label).toBe("Assigned");
    expect(statusPill("checked_in").label).toBe("Checked In");
    expect(statusPill("unassigned").label).toBe("Unassigned");
    expect(statusPill("no_show").label).toBe("No-show");
    expect(statusPill("cancelled").label).toBe("Cancelled");
    expect(statusPill("assigned").className).toContain("bg-");
  });
  it("falls back for unknown status", () => {
    expect(statusPill("weird").label).toBe("weird");
  });
});

describe("monthLabel", () => {
  it("formats an ISO date to City-friendly month", () => {
    expect(monthLabel("2026-08-26")).toBe("Aug 2026");
    expect(monthLabel(null)).toBe("");
  });
});

describe("eventChips", () => {
  it("builds one chip per event with city + month label", () => {
    const events: HubEvent[] = [
      { id: "e1", name: "OH SF", city: "SF", event_date: "2026-08-26", luma_event_id: "evt-1", status: "active", slot_count: 6, booking_count: 2 },
    ];
    const chips = eventChips(events);
    expect(chips[0]).toEqual({ key: "evt-1", label: "SF — Aug 2026" });
  });
});

describe("filterBookings", () => {
  const rows = [
    booking({ id: "b1", luma_event_id: "evt-1", guest_name: "Alice", company: "Acme" }),
    booking({ id: "b2", luma_event_id: "evt-2", guest_name: "Bob", company: "Globex" }),
  ];
  it("filters by event chip key", () => {
    expect(filterBookings(rows, { chip: "evt-1", search: "" }).map((r) => r.id)).toEqual(["b1"]);
  });
  it("returns all for the 'all' chip", () => {
    expect(filterBookings(rows, { chip: "all", search: "" })).toHaveLength(2);
  });
  it("searches name/company/email case-insensitively", () => {
    expect(filterBookings(rows, { chip: "all", search: "globex" }).map((r) => r.id)).toEqual(["b2"]);
    expect(filterBookings(rows, { chip: "all", search: "ALICE" }).map((r) => r.id)).toEqual(["b1"]);
  });
  it("filters by selected statuses (multi-select; empty = all)", () => {
    const s = [
      booking({ id: "u", status: "unassigned" }),
      booking({ id: "a", status: "assigned" }),
      booking({ id: "n", status: "no_show" }),
    ];
    expect(filterBookings(s, { chip: "all", search: "", statuses: [] }).map((r) => r.id)).toEqual(["u", "a", "n"]);
    expect(filterBookings(s, { chip: "all", search: "", statuses: ["no_show"] }).map((r) => r.id)).toEqual(["n"]);
    expect(filterBookings(s, { chip: "all", search: "", statuses: ["unassigned", "assigned"] }).map((r) => r.id)).toEqual(["u", "a"]);
  });
});

describe("groupByCity", () => {
  it("groups rows by location, preserving order", () => {
    const rows = [booking({ id: "b1", location: "SF" }), booking({ id: "b2", location: "NYC" }), booking({ id: "b3", location: "SF" })];
    const groups = groupByCity(rows);
    expect(groups.map((g) => g.city)).toEqual(["SF", "NYC"]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["b1", "b3"]);
  });
});

describe("relativeTime", () => {
  it("renders minutes/hours ago", () => {
    const now = Date.parse("2026-07-30T12:00:00Z");
    expect(relativeTime("2026-07-30T11:58:00Z", now)).toBe("2 min ago");
    expect(relativeTime("2026-07-30T10:00:00Z", now)).toBe("2 hr ago");
    expect(relativeTime(null, now)).toBe("never");
  });
});
