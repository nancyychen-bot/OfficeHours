import { describe, it, expect } from "vitest";
import { buildAgendaBlocks } from "../lib/slack/blocks";

const agenda = {
  email: "grace@x.com",
  name: "Grace Hopper",
  anchorBookingId: "b1",
  eventName: "Build Bar NYC",
  eventDate: "2026-08-26",
  items: [
    { guestName: "Ada", slotName: "2:00 PM", slotStartsAt: "2026-08-26T18:00:00Z", challenge: "Roadmaps", role: "PM", company: "Acme" },
    { guestName: "Bo", slotName: "2:30 PM", slotStartsAt: "2026-08-26T18:30:00Z", challenge: "Databases", role: null, company: null },
  ],
};

describe("buildAgendaBlocks", () => {
  it("renders a header and one line per 1:1 with time, guest, challenge", () => {
    const json = JSON.stringify(buildAgendaBlocks(agenda));
    expect(json).toContain("Build Bar NYC");
    expect(json).toContain("Ada");
    expect(json).toContain("Roadmaps");
    expect(json).toContain("2:00 PM");
    expect(json).toContain("Bo");
    expect(json).toContain("Databases");
  });
});
