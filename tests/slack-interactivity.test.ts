import { describe, it, expect } from "vitest";
import { parseInteraction, feedbackModalView, generalFeedbackModalView } from "../lib/slack/interaction";

describe("parseInteraction", () => {
  it("parses the 'Give feedback' button → open_feedback", () => {
    const payload = { type: "block_actions", actions: [{ action_id: "fb_open", value: "b1" }], trigger_id: "T1" };
    expect(parseInteraction(payload)).toEqual({ kind: "open_feedback", bookingId: "b1", triggerId: "T1" });
  });

  it("parses a modal submit with all fields", () => {
    const payload = {
      type: "view_submission",
      view: {
        private_metadata: "b2",
        state: {
          values: {
            attend: { attend_v: { selected_option: { value: "no" } } },
            rating: { rating_v: { selected_option: { value: "4" } } },
            note: { note_v: { value: "went well" } },
          },
        },
      },
    };
    expect(parseInteraction(payload)).toEqual({ kind: "feedback_submit", bookingId: "b2", attended: false, rating: 4, note: "went well" });
  });

  it("maps 'yes' to attended true", () => {
    const payload = {
      type: "view_submission",
      view: { private_metadata: "b4", state: { values: { attend: { attend_v: { selected_option: { value: "yes" } } } } } },
    };
    expect(parseInteraction(payload)).toMatchObject({ kind: "feedback_submit", bookingId: "b4", attended: true });
  });

  it("leaves blank fields undefined so they don't clobber prior answers", () => {
    const payload = { type: "view_submission", view: { private_metadata: "b3", state: { values: {} } } };
    const r = parseInteraction(payload);
    expect(r).toMatchObject({ kind: "feedback_submit", bookingId: "b3" });
    expect((r as { attended?: boolean }).attended).toBeUndefined();
    expect((r as { rating?: number }).rating).toBeUndefined();
    expect((r as { note?: string }).note).toBeUndefined();
  });

  it("returns ignore for unknown actions", () => {
    expect(parseInteraction({ type: "block_actions", actions: [{ action_id: "other" }] })).toEqual({ kind: "ignore" });
  });
});

describe("feedbackModalView", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const find = (view: any, blockId: string) => view.blocks.find((b: any) => b.block_id === blockId);

  it("pre-fills existing answers", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const view = feedbackModalView("b1", { guestName: "Ada", attended: true, rating: 5, note: "great" }) as any;
    expect(view.private_metadata).toBe("b1");
    expect(JSON.stringify(view)).toContain("Ada");
    expect(find(view, "attend").element.initial_option.value).toBe("yes");
    expect(find(view, "rating").element.initial_option.value).toBe("5");
    expect(find(view, "note").element.initial_value).toBe("great");
  });

  it("omits initial values when there are no prior answers", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const view = feedbackModalView("b2", { guestName: "Bo" }) as any;
    expect(find(view, "attend").element.initial_option).toBeUndefined();
    expect(find(view, "rating").element.initial_option).toBeUndefined();
    expect(find(view, "note").element.initial_value).toBeUndefined();
  });
});

describe("parseInteraction — overall event feedback", () => {
  it("opens the general modal from the top button (gfb_open) carrying event+expert", () => {
    const payload = { type: "block_actions", trigger_id: "t1", actions: [{ action_id: "gfb_open", value: "ev1|grace@x.com" }] };
    expect(parseInteraction(payload)).toEqual({ kind: "open_general", eventId: "ev1", expertEmail: "grace@x.com", triggerId: "t1" });
  });
  it("reads a general_submit from the g:-prefixed private_metadata", () => {
    const payload = { type: "view_submission", view: { private_metadata: "g:ev1|grace@x.com", state: { values: { general: { general_v: { value: "great crowd, more power strips" } } } } } };
    expect(parseInteraction(payload)).toEqual({ kind: "general_submit", eventId: "ev1", expertEmail: "grace@x.com", note: "great crowd, more power strips" });
  });
  it("general_submit note is undefined when blank", () => {
    const payload = { type: "view_submission", view: { private_metadata: "g:ev1|grace@x.com", state: { values: {} } } };
    expect((parseInteraction(payload) as { note?: string }).note).toBeUndefined();
  });
  it("the per-1:1 modal no longer carries a general field", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = feedbackModalView("b1", { guestName: "Ada" }) as any;
    expect(v.blocks.some((b: any) => b.block_id === "general")).toBe(false);
  });
});

describe("generalFeedbackModalView", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const find = (v: any, id: string) => v.blocks.find((b: any) => b.block_id === id);
  it("is a single written box, pre-filled, with event+expert in private_metadata", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = generalFeedbackModalView("ev1", "grace@x.com", { note: "learned a lot" }) as any;
    expect(v.private_metadata).toBe("g:ev1|grace@x.com");
    expect(find(v, "general").element.initial_value).toBe("learned a lot");
  });
});
