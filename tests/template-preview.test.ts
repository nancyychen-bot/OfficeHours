import { describe, it, expect } from "vitest";
import { previewTemplateFor } from "../lib/email/templates";

describe("previewTemplateFor", () => {
  it("returns subject + token-bearing html for a simple kind/role", () => {
    const p = previewTemplateFor("assigned", "guest");
    expect(p).not.toBeNull();
    expect(p!.subject).toContain("Invitation");
    expect(p!.html).toContain("{{expertName}}"); // tokens stay literal in a template preview
    expect(p!.label).toBeTruthy();
  });
  it("resolves a context-variant guest kind to a base variant", () => {
    const p = previewTemplateFor("checked_in", "guest");
    expect(p).not.toBeNull();
    expect(p!.subject.length).toBeGreaterThan(0);
  });
  it("returns null when no template exists for the pair", () => {
    expect(previewTemplateFor("no_show", "guest")).toBeNull(); // no_show is helper-only
  });
});
