import { describe, it, expect } from "vitest";
import { issueFormToken, verifyFormToken } from "@/lib/auth/form-token";

const SECRET = "form-secret";

describe("form token", () => {
  it("accepts a fresh token", async () => {
    const now = 1_800_000_000_000;
    const token = await issueFormToken(SECRET, now);
    expect(await verifyFormToken(token, SECRET, now + 60_000)).toBe(true);
  });

  it("rejects an expired token", async () => {
    const now = 1_800_000_000_000;
    const token = await issueFormToken(SECRET, now);
    // maxAge is 2h; 3h later must fail
    expect(await verifyFormToken(token, SECRET, now + 3 * 60 * 60_000)).toBe(false);
  });

  it("rejects a tampered/garbage token", async () => {
    expect(await verifyFormToken("garbage", SECRET, Date.now())).toBe(false);
  });
});
