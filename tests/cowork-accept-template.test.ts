import { describe, it, expect } from "vitest";
import { templateKeyFor, renderComms, SAMPLE_FIELDS } from "../lib/email/templates";

describe("cowork_only_accept__guest", () => {
  it("routes to the guest template", () => {
    expect(templateKeyFor("cowork_only_accept", "guest", SAMPLE_FIELDS)).toBe(
      "cowork_only_accept__guest",
    );
  });

  it("states we're at capacity for 1:1 and offers coworking with no guarantee", () => {
    const r = renderComms("cowork_only_accept", "guest", SAMPLE_FIELDS)!;
    expect(r.subject.toLowerCase()).toContain("cowork");
    expect(r.text.toLowerCase()).toContain("at capacity for 1:1");
    expect(r.text.toLowerCase()).toContain("cowork with us");
    expect(r.text).toMatch(/does not include a guaranteed 1:1/i);
  });
});
