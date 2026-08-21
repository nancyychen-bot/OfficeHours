import { describe, it, expect } from "vitest";
import { templateKeyFor, renderComms, SAMPLE_FIELDS } from "../lib/email/templates";

describe("cowork_only__guest", () => {
  it("routes to the guest template", () => {
    expect(templateKeyFor("cowork_only", "guest", SAMPLE_FIELDS)).toBe("cowork_only__guest");
  });

  it("renders a coworking + no-1:1 message", () => {
    const r = renderComms("cowork_only", "guest", SAMPLE_FIELDS)!;
    expect(r.subject.toLowerCase()).toContain("cowork");
    expect(r.subject.toLowerCase()).toContain("1:1");
    expect(r.text.toLowerCase()).toContain("cowork");
    expect(r.text).toMatch(/won't be paired|one-on-one|1:1/i);
  });
});
