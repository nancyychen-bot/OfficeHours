import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression: an RSVP to an event that isn't registered in the hub yet (a new
// city's event that went live on Luma before being registered) used to be
// dropped — Luma doesn't resend webhooks, so every RSVP in that window was lost.
// Since the signature proves the request came from a connected calendar, the
// webhook now auto-registers the event (which backfills its guest list) instead.

const ingestRegistration = vi.fn<(...a: any[]) => Promise<any>>();
const registerEventFromLuma = vi.fn<(...a: any[]) => Promise<any>>();
const logSync = vi.fn<(...a: any[]) => Promise<void>>(async () => {});

vi.mock("@/lib/luma/calendars", () => ({
  // No secrets configured → the handler processes the request unsigned, so the
  // test doesn't need to craft a valid signature.
  lumaWebhookSecrets: vi.fn(async () => []),
}));
vi.mock("@/lib/events/ingest", () => ({
  ingestRegistration: (...a: any[]) => (ingestRegistration as any)(...a),
}));
vi.mock("@/lib/events/register", () => ({
  registerEventFromLuma: (...a: any[]) => (registerEventFromLuma as any)(...a),
}));
vi.mock("@/lib/events/cancel-event", () => ({ cancelEventByLumaId: vi.fn(async () => ({ found: false, cancelled: 0 })) }));
vi.mock("@/lib/sync/log", () => ({ logSync: (...a: any[]) => (logSync as any)(...a) }));

import { POST } from "@/app/api/webhooks/luma/route";

function req(body: unknown): Request {
  return new Request("https://hub.test/api/webhooks/luma", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const envelope = {
  type: "guest.registered",
  data: { id: "gst-new", user_email: "sunjung@makenotion.com", event: { id: "evt-new" } },
};

describe("luma webhook — auto-register on unknown event", () => {
  beforeEach(() => {
    ingestRegistration.mockReset();
    registerEventFromLuma.mockReset();
    logSync.mockReset();
  });

  it("auto-registers the event (which backfills the RSVP) instead of dropping it", async () => {
    ingestRegistration.mockResolvedValue({ status: "ignored", reason: "not a registered Notion Build Bar event (evt-new)" });
    registerEventFromLuma.mockResolvedValue({ city: "Seoul", importedGuests: 1 });

    const res = await POST(req(envelope));
    const json = await res.json();

    expect(registerEventFromLuma).toHaveBeenCalledWith({ lumaEvent: "evt-new" });
    expect(json.autoRegistered).toBe(true);
    const actions = logSync.mock.calls.map((c) => (c[0] as any).action);
    expect(actions).toContain("auto_register");
    expect(actions).not.toContain("unknown_event");
  });

  it("falls back to the unknown_event drop when auto-registration fails", async () => {
    ingestRegistration.mockResolvedValue({ status: "ignored", reason: "not a registered Notion Build Bar event (evt-new)" });
    registerEventFromLuma.mockRejectedValue(new Error("Luma event has no address city"));

    const res = await POST(req(envelope));
    const json = await res.json();

    expect(json.ignored).toBe(true);
    const errorLog = logSync.mock.calls.map((c) => c[0] as any).find((a) => a.action === "unknown_event");
    expect(errorLog).toBeTruthy();
    expect(errorLog.result).toBe("error");
    expect(errorLog.note).toContain("auto-register failed");
  });

  it("does not auto-register when the event is already known", async () => {
    ingestRegistration.mockResolvedValue({ status: "ingested", booking: { id: "b1" }, checkedIn: false });

    const res = await POST(req(envelope));
    const json = await res.json();

    expect(registerEventFromLuma).not.toHaveBeenCalled();
    expect(json.received).toBe(true);
  });
});
