import { describe, it, expect } from "vitest";
import { buildAgendaBlocks, buildClaimConfirmBlocks, buildFeedbackBlocks, buildGuestCancelledBlocks } from "../lib/slack/blocks";

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

describe("buildGuestCancelledBlocks", () => {
  it("names the guest and links the city channel when one is known", () => {
    const json = JSON.stringify(buildGuestCancelledBlocks({
      guestName: "Ada Lovelace", eventName: "Build Bar NYC", eventDate: "2026-08-26",
      slotName: "2:00 PM", channelId: "C12345",
    }));
    expect(json).toContain("Ada Lovelace");
    expect(json).toContain("<#C12345>");
    expect(json).toContain("freed up");
  });
  it("falls back to a generic nudge when no channel is known", () => {
    const json = JSON.stringify(buildGuestCancelledBlocks({
      guestName: "Ada Lovelace", eventName: null, eventDate: null, slotName: null, channelId: null,
    }));
    expect(json).toContain("Ada Lovelace");
    expect(json).not.toContain("<#");
    expect(json.toLowerCase()).toContain("build bar channel");
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

  it("renders one 'Give feedback' button per 1:1 carrying the booking id", () => {
    const blocks = buildFeedbackBlocks(prompt) as Array<{ type: string; accessory?: { type: string; action_id?: string; value?: string } }>;
    const guestButtons = blocks.filter((b) => b.accessory?.action_id === "fb_open");
    expect(guestButtons.map((b) => b.accessory!.value)).toEqual(["b1", "b2"]);
  });

  it("renders a top-level 'Overall event feedback' button carrying event|expert", () => {
    const blocks = buildFeedbackBlocks(prompt) as Array<{ accessory?: { action_id?: string; value?: string } }>;
    const overall = blocks.find((b) => b.accessory?.action_id === "gfb_open");
    expect(overall?.accessory?.value).toBe("e1|grace@x.com");
  });
});
