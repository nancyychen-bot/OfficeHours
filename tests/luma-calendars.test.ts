import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { mapCalendarRow } from "@/lib/db/luma-calendars";
import { verifyAnyLumaSignature } from "@/lib/luma/verify";

afterEach(() => vi.restoreAllMocks());

describe("mapCalendarRow", () => {
  it("maps snake_case DB columns to the camelCase row shape", () => {
    expect(
      mapCalendarRow({
        id: "london", api_key: "secret-x", webhook_secret: null,
        calendar_id: "cal-1", city: "London", calendar_url: "https://luma.com/notion-london",
      }),
    ).toEqual({
      id: "london", apiKey: "secret-x", webhookSecret: null,
      calendarId: "cal-1", city: "London", calendarUrl: "https://luma.com/notion-london",
    });
  });
});

import { lumaCalendars, apiKeyForCalendar, lumaWebhookSecrets, calendarUrlForCalendar, __bustCalendarCache } from "@/lib/luma/calendars";
import * as db from "@/lib/db/luma-calendars";

describe("lumaCalendars (env-only, empty DB)", () => {
  afterEach(() => {
    __bustCalendarCache();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(db, "listLumaCalendarRows").mockResolvedValue([]);
  });

  it("includes the default calendar from LUMA_API_KEY / LUMA_WEBHOOK_SECRET when set", async () => {
    vi.stubEnv("LUMA_API_KEY", "default-key");
    vi.stubEnv("LUMA_WEBHOOK_SECRET", "whsec_default");
    __bustCalendarCache();
    const def = (await lumaCalendars()).find((c) => c.id === "default");
    expect(def).toEqual({ id: "default", apiKey: "default-key", webhookSecret: "whsec_default" });
  });

  it("omits the default calendar (and never throws) when LUMA_API_KEY is unset — so retiring it doesn't crash the shared webhook", async () => {
    vi.stubEnv("LUMA_API_KEY", "");
    vi.stubEnv("LUMA_API_KEY_SYDNEY", "sydney-key");
    vi.stubEnv("LUMA_WEBHOOK_SECRET_SYDNEY", "whsec_sydney");
    __bustCalendarCache();
    const cals = await lumaCalendars();
    expect(cals.find((c) => c.id === "default")).toBeUndefined();
    expect(cals.find((c) => c.id === "sydney")?.apiKey).toBe("sydney-key");
    expect(await lumaWebhookSecrets()).toEqual(["whsec_sydney"]);
  });

  it("discovers extra calendars from LUMA_API_KEY_<SUFFIX> + matching secret", async () => {
    vi.stubEnv("LUMA_API_KEY", "default-key");
    vi.stubEnv("LUMA_API_KEY_SYDNEY", "sydney-key");
    vi.stubEnv("LUMA_WEBHOOK_SECRET_SYDNEY", "whsec_sydney");
    __bustCalendarCache();
    const syd = (await lumaCalendars()).find((c) => c.id === "sydney");
    expect(syd).toEqual({ id: "sydney", apiKey: "sydney-key", webhookSecret: "whsec_sydney" });
  });

  it("collects all configured webhook secrets", async () => {
    vi.stubEnv("LUMA_API_KEY", "default-key");
    vi.stubEnv("LUMA_WEBHOOK_SECRET", "whsec_default");
    vi.stubEnv("LUMA_API_KEY_SYDNEY", "sydney-key");
    vi.stubEnv("LUMA_WEBHOOK_SECRET_SYDNEY", "whsec_sydney");
    __bustCalendarCache();
    expect((await lumaWebhookSecrets()).sort()).toEqual(["whsec_default", "whsec_sydney"]);
  });
});

describe("apiKeyForCalendar (env-only, empty DB)", () => {
  afterEach(() => {
    __bustCalendarCache();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(db, "listLumaCalendarRows").mockResolvedValue([]);
  });

  it("resolves a calendar's key; null/empty → default", async () => {
    vi.stubEnv("LUMA_API_KEY", "default-key");
    vi.stubEnv("LUMA_API_KEY_SYDNEY", "sydney-key");
    __bustCalendarCache();
    expect(await apiKeyForCalendar("sydney")).toBe("sydney-key");
    expect(await apiKeyForCalendar(null)).toBe("default-key");
    expect(await apiKeyForCalendar("")).toBe("default-key");
    expect(await apiKeyForCalendar("default")).toBe("default-key");
  });

  it("throws for an unknown (unconfigured) calendar", async () => {
    vi.stubEnv("LUMA_API_KEY", "default-key");
    __bustCalendarCache();
    await expect(apiKeyForCalendar("tokyo")).rejects.toThrow(/tokyo/i);
  });
});

describe("calendarUrlForCalendar (env-only, empty DB)", () => {
  afterEach(() => {
    __bustCalendarCache();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(db, "listLumaCalendarRows").mockResolvedValue([]);
  });

  it("resolves the default and per-suffix calendar URLs, null when unset", async () => {
    vi.stubEnv("LUMA_CALENDAR_URL", "https://luma.com/calendar/cal-default");
    vi.stubEnv("LUMA_CALENDAR_URL_SYDNEY", "https://luma.com/calendar/cal-sydney");
    __bustCalendarCache();
    expect(await calendarUrlForCalendar(null)).toBe("https://luma.com/calendar/cal-default");
    expect(await calendarUrlForCalendar("default")).toBe("https://luma.com/calendar/cal-default");
    expect(await calendarUrlForCalendar("sydney")).toBe("https://luma.com/calendar/cal-sydney");
    expect(await calendarUrlForCalendar("tokyo")).toBeNull();
  });
});

describe("lumaCalendars (DB + env merge)", () => {
  afterEach(() => {
    __bustCalendarCache();
    delete process.env.LUMA_API_KEY;
    delete process.env.LUMA_WEBHOOK_SECRET;
    vi.restoreAllMocks();
  });

  it("merges DB rows over env calendars (DB wins on id conflict) and dedupes", async () => {
    process.env.LUMA_API_KEY = "env-default-key";
    process.env.LUMA_WEBHOOK_SECRET = "env-default-secret";
    vi.spyOn(db, "listLumaCalendarRows").mockResolvedValue([
      { id: "default", apiKey: "db-default-key", webhookSecret: "db-default-secret", calendarId: "cal-d", city: "NYC", calendarUrl: null },
      { id: "london", apiKey: "db-london-key", webhookSecret: "db-london-secret", calendarId: "cal-l", city: "London", calendarUrl: null },
    ]);
    __bustCalendarCache();
    const cals = await lumaCalendars();
    const byId = Object.fromEntries(cals.map((c) => [c.id, c.apiKey]));
    expect(byId).toEqual({ default: "db-default-key", london: "db-london-key" }); // DB 'default' wins over env
  });

  it("falls back to env-only when the DB read throws (fail-open for webhook verify)", async () => {
    process.env.LUMA_API_KEY = "env-default-key";
    process.env.LUMA_WEBHOOK_SECRET = "env-default-secret";
    vi.spyOn(db, "listLumaCalendarRows").mockRejectedValue(new Error("db down"));
    __bustCalendarCache();
    expect(await lumaWebhookSecrets()).toEqual(["env-default-secret"]);
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
