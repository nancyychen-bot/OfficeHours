import { describe, it, expect } from "vitest";
import { buildAgendaBlocks, buildClaimConfirmBlocks } from "../lib/slack/blocks";

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

describe("buildClaimConfirmBlocks", () => {
  it("confirms the guest/slot and tells them to accept the calendar invite", () => {
    const json = JSON.stringify(buildClaimConfirmBlocks({
      guestName: "Ada", slotName: "2:00 PM", eventName: "Build Bar NYC", eventDate: "2026-08-26",
      cardUrl: "https://app.notion.com/abc",
    }));
    expect(json).toContain("Ada");
    expect(json).toContain("2:00 PM");
    expect(json).toContain("accept the calendar invite");
    expect(json).toContain("https://app.notion.com/abc");
  });

  it("omits the card link line when there is no URL", () => {
    const json = JSON.stringify(buildClaimConfirmBlocks({
      guestName: "Ada", slotName: "2:00 PM", eventName: null, eventDate: null, cardUrl: null,
    }));
    expect(json).not.toContain("Open your card");
  });
});
