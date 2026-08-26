import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseLumaEventId, resolveLumaEventId, extractSlotOptions, updateGuestStatus, fetchEventStats } from "@/lib/luma/client";
import type { LumaRegistrationQuestion } from "@/lib/luma/types";

describe("parseLumaEventId", () => {
  it("returns an evt- id unchanged", () => {
    expect(parseLumaEventId("evt-PHUN4WtUCSD9dgi")).toBe("evt-PHUN4WtUCSD9dgi");
  });
  it("extracts an evt- id embedded in a URL/string", () => {
    expect(parseLumaEventId("https://lu.ma/manage/evt-PHUN4WtUCSD9dgi/x")).toBe("evt-PHUN4WtUCSD9dgi");
  });
  it("throws when no evt- id is present", () => {
    expect(() => parseLumaEventId("https://lu.ma/some-slug")).toThrow();
  });
});

describe("resolveLumaEventId", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns an evt- id (or one embedded in a URL) without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveLumaEventId("evt-ABC123")).toBe("evt-ABC123");
    expect(await resolveLumaEventId("https://luma.com/manage/evt-ABC123")).toBe("evt-ABC123");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves a vanity URL by extracting the evt- id from the page HTML", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      text: async () => '<html><script>{"id":"evt-VANITY9zzz"}</script></html>',
    } as Response)));
    expect(await resolveLumaEventId("https://luma.com/g95pjn8u")).toBe("evt-VANITY9zzz");
  });

  it("throws when the vanity page has no evt- id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => "<html>nope</html>" } as Response)));
    await expect(resolveLumaEventId("https://luma.com/nope")).rejects.toThrow(/No evt- id/);
  });

  it("throws for input that is neither an id nor a URL", async () => {
    await expect(resolveLumaEventId("just some words")).rejects.toThrow(/Could not find an evt- id/);
  });
});

describe("extractSlotOptions", () => {
  const slotQ: LumaRegistrationQuestion = {
    id: "q3", label: "Requested time slot for 1:1 help",
    options: ["2:00-2:30 PM", "2:30-3:00 PM", "3:00-3:30 PM"],
  };
  const textQ: LumaRegistrationQuestion = { id: "q1", label: "What company do you work for?" };

  it("returns the ordered labels of the only question with options", () => {
    expect(extractSlotOptions([textQ, slotQ])).toEqual([
      "2:00-2:30 PM", "2:30-3:00 PM", "3:00-3:30 PM",
    ]);
  });
  it("prefers a slot/time-labelled question when several have options", () => {
    const other: LumaRegistrationQuestion = { id: "q9", label: "Dietary preference", options: ["Veg", "Non-veg"] };
    expect(extractSlotOptions([other, slotQ])).toEqual([
      "2:00-2:30 PM", "2:30-3:00 PM", "3:00-3:30 PM",
    ]);
  });
  it("normalizes option objects to their label/name", () => {
    const objQ: LumaRegistrationQuestion = { id: "q3", label: "time slot", options: [{ label: "9:00 AM" }, { name: "9:30 AM" }] };
    expect(extractSlotOptions([objQ])).toEqual(["9:00 AM", "9:30 AM"]);
  });
  it("returns [] when no question has options", () => {
    expect(extractSlotOptions([textQ])).toEqual([]);
  });
});

describe("updateGuestStatus", () => {
  beforeEach(() => {
    process.env.LUMA_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LUMA_API_KEY;
  });

  it("POSTs to /v1/events/guests/update-status with correct body (approved maps to 'approved')", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return { ok: true } as Response;
    });

    await updateGuestStatus({ eventLumaId: "evt-123", guestLumaId: "gst-456", status: "approved", apiKey: "test-key" });

    expect(capturedUrl).toContain("/v1/events/guests/update-status");
    expect(capturedInit?.method).toBe("POST");
    const body = JSON.parse(capturedInit?.body as string);
    expect(body).toEqual({ event_id: "evt-123", guest_id: "gst-456", status: "approved", send_email: true });
  });

  it("pending maps to 'pending_approval' in the request body", async () => {
    let capturedBody: Record<string, string> | undefined;
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return { ok: true } as Response;
    });

    await updateGuestStatus({ eventLumaId: "evt-123", guestLumaId: "gst-456", status: "pending", apiKey: "test-key" });

    expect(capturedBody?.status).toBe("pending_approval");
  });

  it("throws when the response is non-2xx", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 422,
      text: async () => "Unprocessable Entity",
    } as Response));

    await expect(
      updateGuestStatus({ eventLumaId: "evt-123", guestLumaId: "gst-456", status: "approved", apiKey: "test-key" }),
    ).rejects.toThrow("Luma update-guest-status failed: HTTP 422");
  });
});

describe("fetchEventStats", () => {
  beforeEach(() => {
    process.env.LUMA_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LUMA_API_KEY;
  });

  it("counts declined guests toward registered (total ever), not toward the approval buckets", async () => {
    const entries = [
      { approval_status: "approved", event_tickets: [{ checked_in_at: "2026-08-26T00:00:00Z" }] },
      { approval_status: "approved", event_tickets: [] },
      { approval_status: "pending_approval", event_tickets: [] },
      { approval_status: "waitlist", event_tickets: [] },
      { approval_status: "declined", event_tickets: [] },
      { approval_status: "declined", event_tickets: [] },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ entries, has_more: false }) } as Response)),
    );

    const stats = await fetchEventStats("evt-1", "test-key");
    expect(stats.registered).toBe(6); // total ever, incl. the 2 later-declined
    expect(stats.approved).toBe(2);
    expect(stats.pending).toBe(1);
    expect(stats.waitlist).toBe(1);
    expect(stats.checkedIn).toBe(1);
  });
});
