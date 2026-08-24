import { describe, it, expect } from "vitest";
import { mergeCityChannelRow } from "../lib/db/slack";

describe("mergeCityChannelRow", () => {
  it("preserves an existing city's webhook + aliases, updates name + id", () => {
    const row = mergeCityChannelRow(
      { webhook_url: "https://hooks.slack.com/x", aliases: ["brooklyn"] },
      { city: "New York", channelName: "#build-bar-nyc", channelId: "C1" },
    );
    expect(row.webhook_url).toBe("https://hooks.slack.com/x"); // never wiped
    expect(row.aliases).toEqual(["brooklyn"]);
    expect(row.channel_name).toBe("#build-bar-nyc");
    expect(row.channel_id).toBe("C1");
    expect(row.city).toBe("New York");
  });
  it("new city → empty webhook, empty aliases", () => {
    const row = mergeCityChannelRow(null, { city: "Austin", channelName: "#bb-atx", channelId: null });
    expect(row.webhook_url).toBe("");
    expect(row.aliases).toEqual([]);
    expect(row.channel_id).toBeNull();
  });
});
