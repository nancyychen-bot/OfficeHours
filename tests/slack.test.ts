import { describe, it, expect } from "vitest";
import { buildRecruitBlocks, type RecruitInput } from "../lib/slack/client";

const base: RecruitInput = {
  guestName: "Ada Lovelace",
  role: "Engineer",
  company: "Analytical Co",
  challenge: "Automating my team's roadmap in Notion",
  eventName: "Notion Build Bar",
  eventDate: "2026-08-28",
  slotName: "2:00–2:30 PM",
  location: "New York",
  devCardUrl: "https://www.notion.so/dev123",
  ambassadorCardUrl: "https://www.notion.so/amb123",
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

  it("adds a button per workspace so type is attributed correctly", () => {
    const blocks = buildRecruitBlocks(base) as Array<{ type: string; elements?: Array<{ url?: string; text?: { text?: string } }> }>;
    const actions = blocks.find((b) => b.type === "actions");
    const urls = actions?.elements?.map((e) => e.url);
    expect(urls).toContain("https://www.notion.so/amb123");
    expect(urls).toContain("https://www.notion.so/dev123");
    const labels = actions?.elements?.map((e) => e.text?.text);
    expect(labels).toContain("Open Ambassador card");
    expect(labels).toContain("Open Notino card");
  });

  it("shows only the ambassador button when there is no dev card", () => {
    const blocks = buildRecruitBlocks({ ...base, devCardUrl: null }) as Array<{ type: string; elements?: Array<{ url?: string }> }>;
    const actions = blocks.find((b) => b.type === "actions");
    expect(actions?.elements?.map((e) => e.url)).toEqual(["https://www.notion.so/amb123"]);
  });

  it("omits the actions block when there are no card URLs", () => {
    const blocks = buildRecruitBlocks({ ...base, devCardUrl: null, ambassadorCardUrl: null }) as Array<{ type: string }>;
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
