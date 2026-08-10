import { describe, it, expect } from "vitest";
import { buildAgendaBlocks, buildClaimConfirmBlocks, buildFeedbackBlocks } from "../lib/slack/blocks";

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

describe("buildFeedbackBlocks", () => {
  const prompt = {
    email: "grace@x.com", name: "Grace", eventId: "e1", eventName: "NYC", eventDate: "2026-08-26",
    items: [
      { bookingId: "b1", guestName: "Ada", guestEmail: "ada@x.com", slotName: "2:00 PM", challenge: "Roadmaps" },
      { bookingId: "b2", guestName: "Bo", guestEmail: null, slotName: "2:30 PM", challenge: null },
    ],
  };

  it("renders a row per 1:1 with attendance buttons, rating select, and note button carrying the booking id", () => {
    const blocks = buildFeedbackBlocks(prompt) as Array<{ type: string; elements?: Array<{ action_id?: string; value?: string }> }>;
    const actionBlocks = blocks.filter((b) => b.type === "actions");
    expect(actionBlocks).toHaveLength(2); // one per 1:1
    const first = actionBlocks[0].elements ?? [];
    const ids = first.map((e) => e.action_id);
    // action_ids must be unique within the block → two distinct attendance ids
    expect(ids).toContain("fb_attend_yes");
    expect(ids).toContain("fb_attend_no");
    expect(new Set(ids).size).toBe(ids.length); // no duplicate action_id in the block
    expect(ids).toContain("fb_rating");
    expect(ids).toContain("fb_note");
    const attendValues = first.filter((e) => (e.action_id ?? "").startsWith("fb_attend")).map((e) => e.value);
    expect(attendValues).toEqual(["b1:yes", "b1:no"]);
    expect(first.find((e) => e.action_id === "fb_note")?.value).toBe("b1");
  });
});
