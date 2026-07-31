import { describe, it, expect } from "vitest";
import { issueSession, isValidSession, SESSION_COOKIE } from "@/lib/auth/session";

const SECRET = "session-secret";

describe("session", () => {
  it("exposes a stable cookie name", () => {
    expect(SESSION_COOKIE).toBe("hub_session");
  });

  it("issues a token that validates", async () => {
    const token = await issueSession(SECRET);
    expect(await isValidSession(token, SECRET)).toBe(true);
  });

  it("rejects missing or bad tokens", async () => {
    expect(await isValidSession(undefined, SECRET)).toBe(false);
    expect(await isValidSession("bad.token", SECRET)).toBe(false);
    const token = await issueSession(SECRET);
    expect(await isValidSession(token, "wrong-secret")).toBe(false);
  });
});
