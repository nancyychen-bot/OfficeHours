import { describe, it, expect } from "vitest";
import { buildAgendas } from "../lib/events/agenda";
import { renderAgenda } from "../lib/email/templates";

const row = (over: Record<string, unknown>) => ({
  id: "b1", guest_name: "Ada", challenge: "Roadmaps", role: "PM", company: "Acme",
  slot_name: "2:00–2:30 PM", slot_starts_at: "2026-08-26T18:00:00Z",
  booked_by_email: "grace@x.com", booked_by_display_name: "Grace Hopper",
  status: "assigned", event_name: "NYC", event_date: "2026-08-26", ...over,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

describe("buildAgendas", () => {
  it("groups by expert and sorts items by slot start", () => {
    const rows = [
      row({ id: "b1", guest_name: "Ada", slot_starts_at: "2026-08-26T19:00:00Z", slot_name: "3:00 PM" }),
      row({ id: "b2", guest_name: "Bo", slot_starts_at: "2026-08-26T18:00:00Z", slot_name: "2:00 PM" }),
    ];
    const [a] = buildAgendas(rows);
    expect(a.email).toBe("grace@x.com");
    expect(a.items.map((i) => i.guestName)).toEqual(["Bo", "Ada"]); // earliest first
  });

  it("separates two experts and ignores unclaimed / no-show / cancelled", () => {
    const rows = [
      row({ id: "b1", booked_by_email: "grace@x.com" }),
      row({ id: "b2", booked_by_email: "ada@x.com", booked_by_display_name: "Ada L" }),
      row({ id: "b3", booked_by_email: null }), // unclaimed → skipped
      row({ id: "b4", booked_by_email: "grace@x.com", status: "no_show" }), // skipped
      row({ id: "b5", booked_by_email: "grace@x.com", status: "cancelled" }), // skipped
    ];
    const agendas = buildAgendas(rows);
    expect(agendas).toHaveLength(2);
    expect(agendas.find((a) => a.email === "grace@x.com")!.items).toHaveLength(1);
  });

  it("renders an agenda email listing each guest + challenge", () => {
    const [a] = buildAgendas([row({})]);
    const r = renderAgenda({ firstName: "Grace", eventName: a.eventName, eventDate: a.eventDate, items: a.items });
    expect(r.subject).toContain("schedule today");
    expect(r.text).toContain("Hi Grace,");
    expect(r.text).toContain("Ada");
    expect(r.text).toContain("Roadmaps");
    expect(r.text).toContain("2:00–2:30 PM");
  });
});
