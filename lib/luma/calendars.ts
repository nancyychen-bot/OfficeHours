/**
 * A Luma calendar the hub integrates with. Each has its own API key (for outbound
 * calls) and, optionally, a webhook signing secret (for inbound verification).
 */
export interface LumaCalendar {
  id: string;
  apiKey: string;
  webhookSecret: string | null;
}

/**
 * Discover the configured Luma calendars from the environment:
 *  - `default` — the original `LUMA_API_KEY` / `LUMA_WEBHOOK_SECRET`.
 *  - one per `LUMA_API_KEY_<SUFFIX>` var (id = lowercased suffix), its secret from
 *    `LUMA_WEBHOOK_SECRET_<SUFFIX>` (e.g. `LUMA_API_KEY_SYDNEY` → id `sydney`).
 *
 * Adding a calendar is env-only — no code change.
 */
export function lumaCalendars(): LumaCalendar[] {
  const cals: LumaCalendar[] = [];
  // The `default` calendar is included only when LUMA_API_KEY is actually set, so
  // retiring the original calendar (unsetting the var) doesn't crash the shared
  // webhook — which loads this on every request via lumaWebhookSecrets(). A code
  // path that genuinely needs the default key still gets a clear error from
  // apiKeyForCalendar("default"). Read directly (not env.luma.apiKey()'s
  // required()) so this never throws.
  if (process.env.LUMA_API_KEY) {
    cals.push({ id: "default", apiKey: process.env.LUMA_API_KEY, webhookSecret: process.env.LUMA_WEBHOOK_SECRET || null });
  }
  for (const [name, value] of Object.entries(process.env)) {
    const m = /^LUMA_API_KEY_(.+)$/.exec(name);
    if (!m || !value) continue;
    cals.push({
      id: m[1].toLowerCase(),
      apiKey: value,
      webhookSecret: process.env[`LUMA_WEBHOOK_SECRET_${m[1]}`] || null,
    });
  }
  return cals;
}

/**
 * The API key for a calendar id. `null`/`undefined`/empty → the `default`
 * calendar (existing events carry no tag). An unknown, non-default id throws —
 * that's a misconfiguration (the calendar's key isn't set), not a silent fallback.
 */
export function apiKeyForCalendar(id: string | null | undefined): string {
  const cid = id || "default";
  const cal = lumaCalendars().find((c) => c.id === cid);
  if (!cal) {
    const varName = cid === "default" ? "LUMA_API_KEY" : `LUMA_API_KEY_${cid.toUpperCase()}`;
    throw new Error(`Unknown Luma calendar "${cid}" — ${varName} is not configured.`);
  }
  return cal.apiKey;
}

/** Every configured webhook signing secret, for multi-calendar inbound verification. */
export function lumaWebhookSecrets(): string[] {
  return lumaCalendars()
    .map((c) => c.webhookSecret)
    .filter((s): s is string => !!s);
}
