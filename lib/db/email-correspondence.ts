import { getAdminClient } from "../supabase/admin";

export interface EmailGroup {
  eventKind: string;
  eventId: string | null;
  eventName: string | null;
  eventDate: string | null;
  day: string;
  recipientCount: number;
  sentCount: number;
  unsentCount: number;
  lastAt: string;
}

export interface EmailRecipient {
  recipientEmail: string;
  guestName: string | null;
  status: string;
  resendId: string | null;
  createdAt: string;
}

const PAGE_SIZE = 50;

/** One page of grouped sends (kind+event+day), newest first, with optional filters. */
export async function listEmailGroups(opts: {
  kind?: string | null;
  eventId?: string | null;
  page: number;
}): Promise<{ groups: EmailGroup[]; hasMore: boolean }> {
  const page = Math.max(0, opts.page);
  const from = page * PAGE_SIZE;
  // The view isn't in the generated Database types until regenerated post-migration,
  // so cast the client for this one query. Runtime-safe: PostgREST treats it as a table.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (getAdminClient() as any)
    .from("email_correspondence")
    .select("event_kind, event_id, event_name, event_date, day, recipient_count, sent_count, unsent_count, last_at")
    .order("last_at", { ascending: false })
    .range(from, from + PAGE_SIZE); // fetch one extra to compute hasMore
  if (opts.kind) q = q.eq("event_kind", opts.kind);
  if (opts.eventId) q = q.eq("event_id", opts.eventId);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const hasMore = rows.length > PAGE_SIZE;
  const groups = rows.slice(0, PAGE_SIZE).map((r) => ({
    eventKind: r.event_kind as string,
    eventId: (r.event_id as string) ?? null,
    eventName: (r.event_name as string) ?? null,
    eventDate: (r.event_date as string) ?? null,
    day: r.day as string,
    recipientCount: Number(r.recipient_count ?? 0),
    sentCount: Number(r.sent_count ?? 0),
    unsentCount: Number(r.unsent_count ?? 0),
    lastAt: r.last_at as string,
  }));
  return { groups, hasMore };
}

/** The recipients of one group (kind+event+day), newest first. */
export async function listGroupRecipients(opts: {
  kind: string;
  eventId: string | null;
  day: string;
}): Promise<EmailRecipient[]> {
  const supabase = getAdminClient();
  // Day is a UTC calendar day → [day 00:00, next day 00:00).
  const start = `${opts.day}T00:00:00Z`;
  const end = `${opts.day}T23:59:59.999Z`;
  let q = supabase
    .from("email_log")
    .select("recipient_email, status, resend_id, created_at, bookings!inner(guest_name, event_id)")
    .eq("event_kind", opts.kind)
    .gte("created_at", start)
    .lte("created_at", end)
    .order("created_at", { ascending: false });
  if (opts.eventId) q = q.eq("bookings.event_id", opts.eventId);
  const { data, error } = await q;
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    recipientEmail: r.recipient_email,
    guestName: r.bookings?.guest_name ?? null,
    status: r.status,
    resendId: r.resend_id ?? null,
    createdAt: r.created_at,
  }));
}

/** Distinct kinds + events present in the log, for the filter dropdowns. */
export async function listEmailFilterOptions(): Promise<{
  kinds: string[];
  events: Array<{ id: string; name: string | null }>;
}> {
  const supabase = getAdminClient();
  const { data: kindRows } = await supabase.from("email_log").select("event_kind");
  const kinds = [...new Set((kindRows ?? []).map((r) => r.event_kind))].sort();
  const { data: evRows } = await supabase.from("events").select("id, name").order("event_date", { ascending: false });
  const events = (evRows ?? []).map((e) => ({ id: e.id, name: e.name }));
  return { kinds, events };
}
