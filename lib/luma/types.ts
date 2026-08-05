/** Luma webhook payload types (verified against public-api.luma.com/openapi.json). */

export type LumaWebhookType =
  | "guest.registered"
  | "guest.updated"
  | "ticket.registered"
  | "event.created"
  | "event.updated"
  | "event.canceled"
  | "calendar.event.added"
  | "calendar.event.submitted"
  | "calendar.person.subscribed";

export interface LumaRegistrationAnswer {
  label: string;
  question_id: string;
  question_type: string; // text | long-text | dropdown | company | multi-select | ...
  value: unknown; // string | string[] | boolean | { company, job_title } | null
}

export interface LumaEventTicket {
  id?: string;
  name?: string;
  checked_in_at: string | null; // per-ticket check-in timestamp (ISO) or null
  event_ticket_type_id?: string;
}

export interface LumaEventSnapshot {
  id: string; // evt-...
  calendar_id?: string;
  name?: string;
  start_at?: string;
  end_at?: string;
  timezone?: string;
}

export interface LumaGuestData {
  id: string; // gst-... (stable across registered -> updated)
  user_id?: string;
  user_email: string;
  user_name?: string | null;
  user_first_name?: string | null;
  user_last_name?: string | null;
  phone_number?: string | null;
  approval_status?: string;
  registration_answers?: LumaRegistrationAnswer[] | null;
  event_tickets?: LumaEventTicket[] | null;
  event: LumaEventSnapshot;
}

export interface LumaWebhookEnvelope {
  type: LumaWebhookType;
  data: LumaGuestData;
}

/**
 * A row from GET /v1/events/guests/list. Same guest shape as the webhook, minus
 * the nested `event` (the event is the list's query parameter). Used by the
 * backfill to import guests who registered before the event was tracked.
 */
export type LumaGuestListEntry = Omit<LumaGuestData, "event">;

export interface LumaGuestListResponse {
  entries?: LumaGuestListEntry[];
  has_more?: boolean;
  next_cursor?: string;
}

/** Luma event-detail types (from GET /v1/event/get). */
export interface LumaRegistrationQuestion {
  id?: string;
  type?: string;
  label?: string;
  options?: unknown[]; // present for dropdown/multi-select questions
}

export interface LumaEventDetail {
  id: string;
  name: string;
  start_at: string;
  end_at?: string;
  timezone?: string;
  /** Physical location; `geo_address_json.city` is our source for the event city. */
  geo_address_json?: {
    city?: string;
    region?: string;
    country?: string;
    city_state?: string;
    full_address?: string;
  } | null;
  registration_questions?: LumaRegistrationQuestion[] | null;
}
