import { describe, it, expect } from "vitest";
import { buildAnswerPatch } from "../lib/db/expert-feedback";

describe("buildAnswerPatch", () => {
  it("stamps responded_at on the first answer", () => {
    const patch = buildAnswerPatch({ attended: true }, null, "2026-08-26T22:00:00Z");
    expect(patch.attended).toBe(true);
    expect(patch.responded_at).toBe("2026-08-26T22:00:00Z");
    expect(patch.updated_at).toBe("2026-08-26T22:00:00Z");
  });

  it("does NOT overwrite an existing responded_at", () => {
    const patch = buildAnswerPatch({ rating: 5 }, "2026-08-26T21:00:00Z", "2026-08-26T22:00:00Z");
    expect(patch.rating).toBe(5);
    expect(patch.responded_at).toBeUndefined(); // unchanged
    expect(patch.updated_at).toBe("2026-08-26T22:00:00Z");
  });

  it("passes through only provided fields", () => {
    const patch = buildAnswerPatch({ note: "great chat" }, "2026-08-26T21:00:00Z", "2026-08-26T22:00:00Z");
    expect(patch).toMatchObject({ note: "great chat" });
    expect("attended" in patch).toBe(false);
    expect("rating" in patch).toBe(false);
  });
});
