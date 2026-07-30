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
