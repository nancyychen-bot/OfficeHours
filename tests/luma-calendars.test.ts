import { describe, it, expect, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import { lumaCalendars, apiKeyForCalendar, lumaWebhookSecrets, calendarUrlForCalendar } from "@/lib/luma/calendars";
import { verifyAnyLumaSignature } from "@/lib/luma/verify";

describe("lumaCalendars", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("includes the default calendar from LUMA_API_KEY / LUMA_WEBHOOK_SECRET when set", () => {
    vi.stubEnv("LUMA_API_KEY", "default-key");
    vi.stubEnv("LUMA_WEBHOOK_SECRET", "whsec_default");
    const def = lumaCalendars().find((c) => c.id === "default");
    expect(def).toEqual({ id: "default", apiKey: "default-key", webhookSecret: "whsec_default" });
  });

  it("omits the default calendar (and never throws) when LUMA_API_KEY is unset — so retiring it doesn't crash the shared webhook", () => {
    vi.stubEnv("LUMA_API_KEY", "");
    vi.stubEnv("LUMA_API_KEY_SYDNEY", "sydney-key");
    vi.stubEnv("LUMA_WEBHOOK_SECRET_SYDNEY", "whsec_sydney");
    const cals = lumaCalendars();
    expect(cals.find((c) => c.id === "default")).toBeUndefined();
    expect(cals.find((c) => c.id === "sydney")?.apiKey).toBe("sydney-key");
    expect(lumaWebhookSecrets()).toEqual(["whsec_sydney"]);
  });

  it("discovers extra calendars from LUMA_API_KEY_<SUFFIX> + matching secret", () => {
    vi.stubEnv("LUMA_API_KEY", "default-key");
    vi.stubEnv("LUMA_API_KEY_SYDNEY", "sydney-key");
    vi.stubEnv("LUMA_WEBHOOK_SECRET_SYDNEY", "whsec_sydney");
    const syd = lumaCalendars().find((c) => c.id === "sydney");
    expect(syd).toEqual({ id: "sydney", apiKey: "sydney-key", webhookSecret: "whsec_sydney" });
  });

  it("collects all configured webhook secrets", () => {
    vi.stubEnv("LUMA_API_KEY", "default-key");
    vi.stubEnv("LUMA_WEBHOOK_SECRET", "whsec_default");
    vi.stubEnv("LUMA_API_KEY_SYDNEY", "sydney-key");
    vi.stubEnv("LUMA_WEBHOOK_SECRET_SYDNEY", "whsec_sydney");
    expect(lumaWebhookSecrets().sort()).toEqual(["whsec_default", "whsec_sydney"]);
  });
});

describe("apiKeyForCalendar", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("resolves a calendar's key; null/empty → default", () => {
    vi.stubEnv("LUMA_API_KEY", "default-key");
    vi.stubEnv("LUMA_API_KEY_SYDNEY", "sydney-key");
    expect(apiKeyForCalendar("sydney")).toBe("sydney-key");
    expect(apiKeyForCalendar(null)).toBe("default-key");
    expect(apiKeyForCalendar("")).toBe("default-key");
    expect(apiKeyForCalendar("default")).toBe("default-key");
  });

  it("throws for an unknown (unconfigured) calendar", () => {
    vi.stubEnv("LUMA_API_KEY", "default-key");
    expect(() => apiKeyForCalendar("tokyo")).toThrow(/tokyo/i);
  });
});

describe("calendarUrlForCalendar", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("resolves the default and per-suffix calendar URLs, null when unset", () => {
    vi.stubEnv("LUMA_CALENDAR_URL", "https://luma.com/calendar/cal-default");
    vi.stubEnv("LUMA_CALENDAR_URL_SYDNEY", "https://luma.com/calendar/cal-sydney");
    expect(calendarUrlForCalendar(null)).toBe("https://luma.com/calendar/cal-default");
    expect(calendarUrlForCalendar("default")).toBe("https://luma.com/calendar/cal-default");
    expect(calendarUrlForCalendar("sydney")).toBe("https://luma.com/calendar/cal-sydney");
    expect(calendarUrlForCalendar("tokyo")).toBeNull();
  });
});

describe("verifyAnyLumaSignature", () => {
  const rawBody = JSON.stringify({ type: "guest.registered", data: {} });
  const now = 1_800_000_000;
  const sign = (secret: string) =>
    `t=${now},v1=${createHmac("sha256", secret).update(`${now}.${rawBody}`).digest("hex")}`;

  it("accepts a payload signed by ANY configured secret", () => {
    const header = sign("whsec_sydney");
    expect(
      verifyAnyLumaSignature({ rawBody, signatureHeader: header, secrets: ["whsec_default", "whsec_sydney"], nowSec: now }),
    ).toBe(true);
  });

  it("rejects a payload signed by none of them", () => {
    const header = sign("whsec_other");
    expect(
      verifyAnyLumaSignature({ rawBody, signatureHeader: header, secrets: ["whsec_default", "whsec_sydney"], nowSec: now }),
    ).toBe(false);
  });
});
