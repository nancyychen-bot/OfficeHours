import { env } from "../env";
import type { LumaEventDetail, LumaRegistrationQuestion } from "./types";
import type { LumaStatus } from "../sync/types";

const BASE = "https://public-api.luma.com";
const SLOT_HINT = /slot|time|session/i;

/** Extract an `evt-…` id from a raw id or a URL/string that contains one. */
export function parseLumaEventId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/evt-[A-Za-z0-9]+/);
  if (match) return match[0];
  throw new Error(`Could not find an evt- id in: ${input}`);
}

function optionLabel(o: unknown): string {
  if (typeof o === "string") return o;
  if (o && typeof o === "object") {
    const r = o as Record<string, unknown>;
    for (const k of ["label", "name", "value", "text"]) {
      if (typeof r[k] === "string") return r[k] as string;
    }
  }
  return String(o);
}

/**
 * Given a Luma event's registration questions, return the ordered option labels
 * of the slot dropdown. Picks the sole question with options, else the one whose
 * label hints slot/time, else the first with options. [] if none.
 */
export function extractSlotOptions(questions: LumaRegistrationQuestion[]): string[] {
  const withOptions = (questions ?? []).filter(
    (q) => Array.isArray(q.options) && q.options.length > 0,
  );
  if (withOptions.length === 0) return [];
  const chosen =
    withOptions.length === 1
      ? withOptions[0]
      : withOptions.find((q) => SLOT_HINT.test(q.label ?? "")) ?? withOptions[0];
  return (chosen.options ?? []).map(optionLabel);
}

/** Fetch full event detail (host-only) incl. registration_questions. */
export async function getLumaEvent(eventId: string): Promise<LumaEventDetail> {
  const res = await fetch(`${BASE}/v1/event/get?api_id=${encodeURIComponent(eventId)}`, {
    headers: { "x-luma-api-key": env.luma.apiKey() },
  });
  if (!res.ok) {
    throw new Error(`Luma getEvent ${eventId} failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { event?: LumaEventDetail } & Partial<LumaEventDetail>;
  const ev = body.event ?? (body as LumaEventDetail);
  if (!ev?.id) throw new Error(`Luma getEvent ${eventId}: unexpected response shape`);
  return ev;
}

/**
 * The value Luma's update-guest-status endpoint expects for each hub status.
 * ⚠️ VERIFY the exact spelling against the live endpoint before production
 * (docs.luma.com/reference/post_v1-event-update-guest-status). Adjust here only.
 */
const LUMA_API_STATUS: Record<LumaStatus, string> = {
  approved: "approved",
  declined: "declined",
  waitlist: "waitlist",
  pending: "pending_approval",
};

/**
 * Push an approval decision back to Luma (Notion-originated changes only).
 * Throws on non-2xx so the caller can log it; Luma reconciles via its own webhook
 * on the next guest.updated.
 */
export async function updateGuestStatus(params: {
  eventLumaId: string; // evt-…
  guestLumaId: string; // gst-…
  status: LumaStatus;
}): Promise<void> {
  const res = await fetch(`${BASE}/v1/event/update-guest-status`, {
    method: "POST",
    headers: {
      "x-luma-api-key": env.luma.apiKey(),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      event_api_id: params.eventLumaId,
      guest_api_id: params.guestLumaId,
      status: LUMA_API_STATUS[params.status],
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Luma update-guest-status failed: HTTP ${res.status} ${await res.text().catch(() => "")}`.trim(),
    );
  }
}
