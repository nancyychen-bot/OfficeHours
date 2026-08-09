import { describe, it, expect } from "vitest";
import { parseInteraction } from "../lib/slack/interaction";

describe("parseInteraction", () => {
  it("parses an attendance button click", () => {
    const payload = {
      type: "block_actions",
      actions: [{ action_id: "fb_attend", value: "b1:no" }],
      container: { channel_id: "D1", message_ts: "9.9" },
    };
    expect(parseInteraction(payload)).toEqual({ kind: "attend", bookingId: "b1", attended: false, channel: "D1", ts: "9.9" });
  });

  it("parses a rating select", () => {
    const payload = {
      type: "block_actions",
      actions: [{ action_id: "fb_rating", selected_option: { value: "b2:4" } }],
      container: { channel_id: "D1", message_ts: "9.9" },
    };
    expect(parseInteraction(payload)).toEqual({ kind: "rating", bookingId: "b2", rating: 4, channel: "D1", ts: "9.9" });
  });

  it("parses a note button (opens modal)", () => {
    const payload = {
      type: "block_actions",
      actions: [{ action_id: "fb_note", value: "b3" }],
      trigger_id: "T1",
    };
    expect(parseInteraction(payload)).toEqual({ kind: "note_open", bookingId: "b3", triggerId: "T1" });
  });

  it("parses a note modal submission", () => {
    const payload = {
      type: "view_submission",
      view: {
        private_metadata: "b4",
        state: { values: { note_block: { note_input: { value: "wonderful session" } } } },
      },
    };
    expect(parseInteraction(payload)).toEqual({ kind: "note_submit", bookingId: "b4", note: "wonderful session" });
  });

  it("returns ignore for unknown actions", () => {
    expect(parseInteraction({ type: "block_actions", actions: [{ action_id: "other" }] })).toEqual({ kind: "ignore" });
  });
});
