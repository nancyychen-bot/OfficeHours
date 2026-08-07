import { describe, it, expect } from "vitest";
import { renderComms, templateKeyFor, SAMPLE_FIELDS } from "../lib/email/templates";

// (admin membership is now DB-backed — see lib/db/admins; covered via integration)

describe("unclaim_denied email", () => {
  it("routes to the helper template and names the claimer + Nancy", () => {
    expect(templateKeyFor("unclaim_denied", "helper", SAMPLE_FIELDS)).toBe("unclaim_denied__helper");
    const r = renderComms("unclaim_denied", "helper", { ...SAMPLE_FIELDS, helperName: "Grace Hopper" })!;
    expect(r.text).toContain("claimed by Grace Hopper");
    expect(r.text).toContain("Only the person who claimed");
    expect(r.text).toContain("Nancy Chen");
  });
});
