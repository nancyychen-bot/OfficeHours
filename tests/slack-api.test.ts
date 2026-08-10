import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dmByEmail, lookupUserByEmail, postToChannel } from "../lib/slack/api";

interface Call { url: string; contentType: string; raw: string; body: unknown }
const calls: Call[] = [];
function stubFetch(responder: (url: string) => unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = vi.fn(async (url: string, init: any) => {
    const contentType = String(init.headers?.["Content-Type"] ?? "");
    const raw = String(init.body ?? "");
    // JSON methods parse to an object; form methods stay as the raw query string.
    const body = contentType.includes("application/json") ? JSON.parse(raw) : raw;
    calls.push({ url, contentType, raw, body });
    return { ok: true, json: async () => responder(url) } as unknown as Response;
  });
}

beforeEach(() => { calls.length = 0; process.env.SLACK_BOT_TOKEN = "xoxb-test"; });
afterEach(() => { delete process.env.SLACK_BOT_TOKEN; vi.restoreAllMocks(); });

describe("dmByEmail", () => {
  it("looks up the user, opens a DM, and posts", async () => {
    stubFetch((url) => {
      if (url.includes("users.lookupByEmail")) return { ok: true, user: { id: "U1" } };
      if (url.includes("conversations.open")) return { ok: true, channel: { id: "D1" } };
      if (url.includes("chat.postMessage")) return { ok: true, ts: "123.45" };
      return { ok: false };
    });
    const res = await dmByEmail("grace@x.com", [{ type: "section" }], "hi");
    expect(res.ok).toBe(true);
    expect(calls.map((c) => c.url).some((u) => u.includes("chat.postMessage"))).toBe(true);
  });

  it("soft-fails (ok:false) when the user is not found", async () => {
    stubFetch(() => ({ ok: false, error: "users_not_found" }));
    const res = await dmByEmail("nobody@x.com", [], "hi");
    expect(res.ok).toBe(false);
  });

  it("no-ops when SLACK_BOT_TOKEN is unset", async () => {
    delete process.env.SLACK_BOT_TOKEN;
    stubFetch(() => ({ ok: true }));
    const res = await dmByEmail("grace@x.com", [], "hi");
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(0); // never hit the network
  });
});

describe("lookupUserByEmail", () => {
  // Regression: users.lookupByEmail only reads form-encoded params, NOT a JSON
  // body. Sending JSON makes Slack see no email → user_not_found.
  it("sends the email as application/x-www-form-urlencoded, not JSON", async () => {
    stubFetch(() => ({ ok: true, user: { id: "U9" } }));
    const id = await lookupUserByEmail("grace@x.com");
    expect(id).toBe("U9");
    const call = calls.find((c) => c.url.includes("users.lookupByEmail"))!;
    expect(call.contentType).toContain("application/x-www-form-urlencoded");
    expect(call.raw).toBe("email=grace%40x.com");
  });
});

describe("postToChannel", () => {
  it("posts blocks to a channel id", async () => {
    stubFetch(() => ({ ok: true, ts: "9.9" }));
    const res = await postToChannel("C123", [{ type: "section" }], "yo");
    expect(res.ok).toBe(true);
    expect(calls[0].url).toContain("chat.postMessage");
    expect(calls[0].contentType).toContain("application/json");
    expect((calls[0].body as { channel: string }).channel).toBe("C123");
  });
});
