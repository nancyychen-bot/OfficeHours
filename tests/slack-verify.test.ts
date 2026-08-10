import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifySlackSignature } from "../lib/slack/verify";

const SECRET = "test-signing-secret";
function sign(body: string, ts: string): string {
  const base = `v0:${ts}:${body}`;
  return "v0=" + createHmac("sha256", SECRET).update(base).digest("hex");
}

describe("verifySlackSignature", () => {
  const now = Math.floor(Date.parse("2026-08-07T12:00:00Z") / 1000);
  const body = "payload=%7B%22type%22%3A%22block_actions%22%7D";

  it("accepts a correctly signed, fresh request", () => {
    const ts = String(now);
    expect(verifySlackSignature(body, ts, sign(body, ts), SECRET, now)).toBe(true);
  });

  it("rejects a bad signature", () => {
    const ts = String(now);
    expect(verifySlackSignature(body, ts, "v0=deadbeef", SECRET, now)).toBe(false);
  });

  it("rejects a stale timestamp (> 5 min skew)", () => {
    const ts = String(now - 60 * 6);
    expect(verifySlackSignature(body, ts, sign(body, ts), SECRET, now)).toBe(false);
  });

  it("returns false when the secret is missing", () => {
    const ts = String(now);
    expect(verifySlackSignature(body, ts, sign(body, ts), undefined, now)).toBe(false);
  });
});
