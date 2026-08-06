import { describe, it, expect } from "vitest";
import { buildRecruitBlocks, notionCardUrl, type RecruitInput } from "../lib/slack/client";

const base: RecruitInput = {
  guestName: "Ada Lovelace",
  role: "Engineer",
  company: "Analytical Co",
  challenge: "Automating my team's roadmap in Notion",
  eventName: "Notion Build Bar",
  eventDate: "2026-08-28",
  slotName: "2:00–2:30 PM",
  location: "New York",
  cardUrl: "https://www.notion.so/abc123",
};

describe("buildRecruitBlocks", () => {
  it("includes the key guest info and a formatted when line", () => {
    const json = JSON.stringify(buildRecruitBlocks(base));
    expect(json).toContain("just opened up");
    expect(json).toContain("Ada Lovelace");
    expect(json).toContain("Engineer @ Analytical Co");
    expect(json).toContain("Automating my team's roadmap in Notion");
    expect(json).toContain("Aug 28 · 2:00–2:30 PM"); // shortDate + slot
    expect(json).toContain("New York");
  });

  it("adds a link button when a card URL is present", () => {
    const blocks = buildRecruitBlocks(base) as Array<{ type: string; elements?: Array<{ url?: string }> }>;
    const actions = blocks.find((b) => b.type === "actions");
    expect(actions?.elements?.[0]?.url).toBe("https://www.notion.so/abc123");
  });

  it("omits the actions block when there is no card URL", () => {
    const blocks = buildRecruitBlocks({ ...base, cardUrl: null }) as Array<{ type: string }>;
    expect(blocks.some((b) => b.type === "actions")).toBe(false);
  });

  it("degrades gracefully when optional fields are missing", () => {
    const json = JSON.stringify(
      buildRecruitBlocks({ ...base, role: null, company: null, challenge: null, eventDate: null, slotName: null, location: null }),
    );
    expect(json).toContain("Ada Lovelace");
    expect(json).toContain("—"); // em-dash fallbacks
  });
});

describe("notionCardUrl", () => {
  it("strips dashes from the page id", () => {
    expect(notionCardUrl("11112222-3333-4444-5555-666677778888")).toBe(
      "https://www.notion.so/11112222333344445555666677778888",
    );
  });
  it("returns null without a page id", () => {
    expect(notionCardUrl(null)).toBeNull();
    expect(notionCardUrl(undefined)).toBeNull();
  });
});
