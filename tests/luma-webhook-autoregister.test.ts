import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression: an RSVP to an event that isn't registered in the hub yet (a new
// city's event that went live on Luma before being registered) used to be
// dropped — Luma doesn't resend webhooks, so every RSVP in that window was lost.
// Since the signature proves the request came from a connected calendar, the
// webhook now auto-registers the event (which backfills its guest list) instead.

const ingestRegistration = vi.fn<(...a: any[]) => Promise<any>>();
const registerEventFromLuma = vi.fn<(...a: any[]) => Promise<any>>();
const logSync = vi.fn<(...a: any[]) => Promise<void>>(async () => {});

// Mirrors the real class so the webhook's `instanceof` check matches (the mock
// below exports THIS class as the module's NotABuildBarEventError). Defined via
// vi.hoisted so it exists when the hoisted vi.mock factory runs.
const { NotABuildBarEventError } = vi.hoisted(() => {
  class NotABuildBarEventError extends Error {
    eventId: string;
    eventName: string;
    constructor(eventId: string, eventName: string) {
      super(`${eventId} ("${eventName}") is not a Build Bar event`);
      this.name = "NotABuildBarEventError";
      this.eventId = eventId;
      this.eventName = eventName;
    }
  }
  return { NotABuildBarEventError };
});

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
  NotABuildBarEventError,
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

    expect(registerEventFromLuma).toHaveBeenCalledWith({ lumaEvent: "evt-new" }, { requireBuildBarName: true });
    expect(json.autoRegistered).toBe(true);
    const actions = logSync.mock.calls.map((c) => (c[0] as any).action);
    expect(actions).toContain("auto_register");
    expect(actions).not.toContain("unknown_event");
  });

  it("skips a foreign (non-Build-Bar) event instead of registering it or emailing", async () => {
    ingestRegistration.mockResolvedValue({ status: "ignored", reason: "not a registered Notion Build Bar event (evt-new)" });
    registerEventFromLuma.mockRejectedValue(new NotABuildBarEventError("evt-new", "How AI are you? Come find out."));

    const res = await POST(req(envelope));
    const json = await res.json();

    expect(json.skipped).toBe(true);
    const actions = logSync.mock.calls.map((c) => (c[0] as any).action);
    expect(actions).toContain("skipped_foreign_event");
    expect(actions).not.toContain("unknown_event");
    const log = logSync.mock.calls.map((c) => c[0] as any).find((a) => a.action === "skipped_foreign_event");
    expect(log.result).toBe("applied");
    expect(log.note).toContain("How AI are you?");
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

// Regression: a rescheduled Luma event sends `event.updated`, which used to be
// ignored — so the hub's event_date/slots went stale and bookings sat under the
// wrong date (the Singapore Oct-1→Oct-22 reschedule hid every RSVP from the
// Oct-22 view). Now `event.updated` refreshes the event from Luma.
describe("luma webhook — event.updated refreshes the event", () => {
  beforeEach(() => {
    ingestRegistration.mockReset();
    registerEventFromLuma.mockReset();
    logSync.mockReset();
  });

  const updated = { type: "event.updated", data: { event: { id: "evt-resched" } } };

  it("re-registers the event (refreshing date/slots) and does not ingest a guest", async () => {
    registerEventFromLuma.mockResolvedValue({ city: "Singapore", importedGuests: 242 });

    const res = await POST(req(updated));
    const json = await res.json();

    expect(registerEventFromLuma).toHaveBeenCalledWith({ lumaEvent: "evt-resched" }, { requireBuildBarName: true });
    expect(ingestRegistration).not.toHaveBeenCalled();
    expect(json.received).toBe(true);
    const log = logSync.mock.calls.map((c) => c[0] as any).find((a) => a.action === "event.updated");
    expect(log.result).toBe("applied");
    expect(log.note).toMatch(/refresh/i);
  });

  it("ignores a foreign (non-Build-Bar) event's update without erroring", async () => {
    registerEventFromLuma.mockRejectedValue(new NotABuildBarEventError("evt-resched", "AI Labs"));

    const res = await POST(req(updated));
    const json = await res.json();

    expect(json.received).toBe(true);
    const log = logSync.mock.calls.map((c) => c[0] as any).find((a) => a.action === "event.updated");
    expect(log.result).toBe("applied");
    expect(log.note).toMatch(/foreign|ignored/i);
  });

  it("logs an error (still 200) when the refresh fails transiently", async () => {
    registerEventFromLuma.mockRejectedValue(new Error("Luma unreachable"));

    const res = await POST(req(updated));
    const json = await res.json();

    expect(json.received).toBe(true);
    const log = logSync.mock.calls.map((c) => c[0] as any).find((a) => a.action === "event.updated");
    expect(log.result).toBe("error");
  });
});
