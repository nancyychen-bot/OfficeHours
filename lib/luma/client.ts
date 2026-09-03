import type {
  LumaEventDetail,
  LumaRegistrationQuestion,
  LumaGuestListEntry,
  LumaGuestListResponse,
} from "./types";
import type { LumaStatus } from "../sync/types";
import { lumaCalendars } from "./calendars";

const BASE = "https://public-api.luma.com";
const SLOT_HINT = /slot|time|session/i;

/** The vanity slug of a Luma URL = its last non-empty path segment, lowercased.
 * Lets us match `lu.ma/foo` against Luma's stored `luma.com/foo` interchangeably. */
function slugFromUrl(u: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    const seg = url.pathname.split("/").filter(Boolean).pop();
    return seg ? seg.toLowerCase() : null;
  } catch {
    return null;
  }
}

interface CalEventEntry {
  id: string; // evt-…
  url?: string; // public vanity URL
}
interface CalEventsPage {
  entries?: CalEventEntry[];
  has_more?: boolean;
  next_cursor?: string;
}

/** Find the `evt-` id of the calendar's upcoming event whose vanity slug matches,
 * or null. Scans only upcoming events (2-day back-buffer) — an event being added
 * is always upcoming, so even a busy calendar stays a page or two. Throws on a
 * non-2xx so the caller can fall through to the next calendar. */
async function findEventIdInCalendar(apiKey: string, slug: string): Promise<string | null> {
  const after = new Date(Date.now() - 2 * 86_400_000).toISOString();
  let cursor: string | undefined;
  do {
    const url = new URL(`${BASE}/v1/calendars/events/list`);
    url.searchParams.set("after", after);
    url.searchParams.set("pagination_limit", "50");
    if (cursor) url.searchParams.set("pagination_cursor", cursor);
    const res = await fetch(url, { headers: { "x-luma-api-key": apiKey } });
    if (!res.ok) throw new Error(`Luma calendars/events/list failed: HTTP ${res.status}`);
    const body = (await res.json()) as CalEventsPage;
    for (const e of body.entries ?? []) {
      if (e.url && slugFromUrl(e.url) === slug) return e.id;
    }
    cursor = body.has_more && body.next_cursor ? body.next_cursor : undefined;
  } while (cursor);
  return null;
}

/** Resolve a public vanity URL to an `evt-` id via Luma's authenticated API by
 * matching the slug against each configured calendar's upcoming events. Returns
 * null if no connected calendar lists it. The calendar whose key finds it is also
 * the event's owner — reliable from serverless/datacenter IPs, where scraping the
 * Cloudflare-fronted public page is not. */
async function resolveEventIdViaCalendars(vanityUrl: string): Promise<string | null> {
  const slug = slugFromUrl(vanityUrl);
  if (!slug) return null;
  for (const cal of await lumaCalendars()) {
    try {
      const id = await findEventIdInCalendar(cal.apiKey, slug);
      if (id) return id;
    } catch {
      // A single key failing (revoked, rate-limited) shouldn't abort resolution.
    }
  }
  return null;
}

/** Extract an `evt-…` id from a raw id or a URL/string that contains one. */
export function parseLumaEventId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/evt-[A-Za-z0-9]+/);
  if (match) return match[0];
  throw new Error(`Could not find an evt- id in: ${input}`);
}

/**
 * Resolve a Luma event id from user input. Accepts an `evt-…` id, any URL that
 * contains one (e.g. a manage link), OR a public vanity URL like
 * `https://luma.com/g95pjn8u`.
 *
 * The public API only takes `evt-` ids. For a vanity URL we first resolve it via
 * the authenticated calendars/events/list API (matching the slug against each
 * connected calendar's upcoming events) — reliable from serverless. Only if that
 * finds nothing do we fall back to scraping the page's embedded `evt-` id, which
 * Luma's bot protection often blocks from datacenter IPs (the SF add-event bug).
 */
export async function resolveLumaEventId(input: string): Promise<string> {
  const trimmed = input.trim();
  const direct = trimmed.match(/evt-[A-Za-z0-9]+/);
  if (direct) return direct[0];

  const looksLikeUrl = /^https?:\/\//i.test(trimmed) || /\b(lu\.ma|luma\.com)\//i.test(trimmed);
  if (!looksLikeUrl) {
    throw new Error(`Could not find an evt- id in: ${input}`);
  }

  // Preferred: authenticated API match (Cloudflare-proof; also identifies owner).
  const viaApi = await resolveEventIdViaCalendars(trimmed);
  if (viaApi) return viaApi;

  // Fallback: scrape the public page (best-effort; often blocked from datacenter IPs).
  const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; NotionBuildBarHub/1.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new Error(`Could not load Luma page ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new Error(`Could not load Luma page ${url}: HTTP ${res.status}`);
  const found = (await res.text()).match(/evt-[A-Za-z0-9]+/);
  if (found) return found[0];
  throw new Error(`No evt- id found on Luma page ${url}`);
}

/**
 * List every guest for an event (host-only), following cursor pagination. Used
 * by the backfill to import guests who registered before the hub tracked the
 * event — Luma doesn't resend webhooks retroactively.
 */
export async function listEventGuests(eventId: string, apiKey: string): Promise<LumaGuestListEntry[]> {
  const out: LumaGuestListEntry[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL(`${BASE}/v1/events/guests/list`);
    url.searchParams.set("event_id", eventId);
    url.searchParams.set("pagination_limit", "50");
    if (cursor) url.searchParams.set("pagination_cursor", cursor);
    const res = await fetch(url, { headers: { "x-luma-api-key": apiKey } });
    if (!res.ok) throw new Error(`Luma guests/list ${eventId} failed: HTTP ${res.status}`);
    const body = (await res.json()) as LumaGuestListResponse;
    out.push(...(body.entries ?? []));
    cursor = body.has_more && body.next_cursor ? body.next_cursor : undefined;
  } while (cursor);
  return out;
}

export interface LumaEventStats {
  registered: number;
  approved: number;
  checkedIn: number;
  waitlist: number;
  pending: number;
  capacity: number | null;
}

/** Authoritative per-event counts straight from Luma's guest list. */
export async function fetchEventStats(eventId: string, apiKey: string): Promise<LumaEventStats> {
  const guests = await listEventGuests(eventId, apiKey);
  const stats: LumaEventStats = { registered: 0, approved: 0, checkedIn: 0, waitlist: 0, pending: 0, capacity: null };
  for (const g of guests) {
    const st = g.approval_status;
    // `registered` = total ever registered (every guest-list entry, INCLUDING
    // later-declined). It must be monotonic so the day-before auto-decline sweep
    // doesn't shrink the dashboard's headline number. The approval sub-buckets
    // still exclude declined.
    stats.registered++;
    if (st === "approved") stats.approved++;
    else if (st === "waitlist") stats.waitlist++;
    else if (st === "pending_approval") stats.pending++;
    if ((g.event_tickets ?? []).some((t) => t.checked_in_at)) stats.checkedIn++;
  }
  return stats;
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
export async function getLumaEvent(eventId: string, apiKey: string): Promise<LumaEventDetail> {
  const res = await fetch(`${BASE}/v1/event/get?api_id=${encodeURIComponent(eventId)}`, {
    headers: { "x-luma-api-key": apiKey },
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
 * Verified against the live OpenAPI (POST /v1/events/guests/update-status):
 * status ∈ approved | declined | pending_approval | waitlist.
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
  apiKey: string; // the owning calendar's key
}): Promise<void> {
  const res = await fetch(`${BASE}/v1/events/guests/update-status`, {
    method: "POST",
    headers: {
      "x-luma-api-key": params.apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      event_id: params.eventLumaId,
      guest_id: params.guestLumaId,
      status: LUMA_API_STATUS[params.status],
      // Let Luma send its confirmation/ticket email only on approval; for
      // declined/waitlist/pending the hub owns the guest messaging (no duplicate).
      send_email: params.status === "approved",
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Luma update-guest-status failed: HTTP ${res.status} ${await res.text().catch(() => "")}`.trim(),
    );
  }
}
