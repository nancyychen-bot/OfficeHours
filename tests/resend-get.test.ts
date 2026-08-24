import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getSentEmail } from "../lib/email/resend";

beforeEach(() => { process.env.RESEND_API_KEY = "re_test"; });
afterEach(() => { delete process.env.RESEND_API_KEY; vi.restoreAllMocks(); });

function stub(status: number, body: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response);
}

describe("getSentEmail", () => {
  it("returns subject/html/text/to on 200", async () => {
    stub(200, { id: "e1", subject: "Hi", html: "<p>hi</p>", text: "hi", to: ["a@x.com"] });
    const r = await getSentEmail("e1");
    expect(r).toEqual({ subject: "Hi", html: "<p>hi</p>", text: "hi", to: ["a@x.com"] });
  });
  it("returns null on 404 (aged out)", async () => {
    stub(404, { name: "not_found" });
    expect(await getSentEmail("gone")).toBeNull();
  });
  it("returns null for an empty id (no fetch)", async () => {
    let called = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = vi.fn(async () => { called = true; return {} as Response; });
    expect(await getSentEmail("")).toBeNull();
    expect(called).toBe(false);
  });
});
