import { describe, it, expect } from "vitest";
import { signToken, verifyToken } from "@/lib/auth/token";

const SECRET = "test-secret-value";

describe("signToken / verifyToken", () => {
  it("round-trips a payload", async () => {
    const token = await signToken("hub.123", SECRET);
    expect(await verifyToken(token, SECRET)).toBe("hub.123");
  });

  it("rejects a tampered payload", async () => {
    const token = await signToken("hub.123", SECRET);
    const tampered = token.replace("hub.123", "hub.999");
    expect(await verifyToken(tampered, SECRET)).toBeNull();
  });

  it("rejects a wrong secret", async () => {
    const token = await signToken("hub.123", SECRET);
    expect(await verifyToken(token, "other-secret")).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await verifyToken("nonsense", SECRET)).toBeNull();
    expect(await verifyToken("", SECRET)).toBeNull();
  });
});
