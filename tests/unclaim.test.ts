import { describe, it, expect } from "vitest";
import { isUnclaimAdmin } from "../lib/auth/admins";
import { renderComms, templateKeyFor, SAMPLE_FIELDS } from "../lib/email/templates";

describe("isUnclaimAdmin", () => {
  it("allows the configured admins (case-insensitive), rejects others", () => {
    expect(isUnclaimAdmin("nchen@makenotion.com")).toBe(true);
    expect(isUnclaimAdmin("EYY@makenotion.com")).toBe(true);
    expect(isUnclaimAdmin("vanessa.intan@makenotion.com")).toBe(true);
    expect(isUnclaimAdmin("faisa.mohamed@makenotion.com")).toBe(true);
    expect(isUnclaimAdmin("someone.else@makenotion.com")).toBe(false);
    expect(isUnclaimAdmin(null)).toBe(false);
    expect(isUnclaimAdmin("")).toBe(false);
  });
});

describe("unclaim_denied email", () => {
  it("routes to the helper template and names the claimer + Nancy", () => {
    expect(templateKeyFor("unclaim_denied", "helper", SAMPLE_FIELDS)).toBe("unclaim_denied__helper");
    const r = renderComms("unclaim_denied", "helper", { ...SAMPLE_FIELDS, helperName: "Grace Hopper" })!;
    expect(r.text).toContain("claimed by Grace Hopper");
    expect(r.text).toContain("Only the person who claimed");
    expect(r.text).toContain("Nancy Chen");
  });
});
