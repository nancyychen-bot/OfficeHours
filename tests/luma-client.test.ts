import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseLumaEventId, extractSlotOptions, updateGuestStatus } from "@/lib/luma/client";
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

  it("POSTs to /v1/event/update-guest-status with correct body (approved maps to 'approved')", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return { ok: true } as Response;
    });

    await updateGuestStatus({ eventLumaId: "evt-123", guestLumaId: "gst-456", status: "approved" });

    expect(capturedUrl).toContain("/v1/event/update-guest-status");
    expect(capturedInit?.method).toBe("POST");
    const body = JSON.parse(capturedInit?.body as string);
    expect(body).toEqual({ event_api_id: "evt-123", guest_api_id: "gst-456", status: "approved" });
  });

  it("pending maps to 'pending_approval' in the request body", async () => {
    let capturedBody: Record<string, string> | undefined;
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return { ok: true } as Response;
    });

    await updateGuestStatus({ eventLumaId: "evt-123", guestLumaId: "gst-456", status: "pending" });

    expect(capturedBody?.status).toBe("pending_approval");
  });

  it("throws when the response is non-2xx", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 422,
      text: async () => "Unprocessable Entity",
    } as Response));

    await expect(
      updateGuestStatus({ eventLumaId: "evt-123", guestLumaId: "gst-456", status: "approved" }),
    ).rejects.toThrow("Luma update-guest-status failed: HTTP 422");
  });
});
