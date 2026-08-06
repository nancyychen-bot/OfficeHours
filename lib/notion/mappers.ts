import type { Booking, BookingStatus, BookedByType, SyncedFields, LumaStatus } from "../sync/types";
import { PROP, STATUS_LABEL, BOOKED_BY_TYPE_LABEL, LUMA_STATUS_LABEL } from "./schema";

/**
 * Translate between the hub's canonical booking and Notion page properties.
 * Only the fields in SyncedFields cross the boundary on updates; the native
 * `Booked by` PEOPLE property is intentionally never touched here (PRD §6.3).
 */

// ---- enum <-> Notion select label ------------------------------------------

const STATUS_FROM_LABEL: Record<string, BookingStatus> = Object.fromEntries(
  Object.entries(STATUS_LABEL).map(([k, v]) => [v, k as BookingStatus]),
);
const TYPE_FROM_LABEL: Record<string, BookedByType> = Object.fromEntries(
  Object.entries(BOOKED_BY_TYPE_LABEL).map(([k, v]) => [v, k as BookedByType]),
);

export function statusToLabel(s: BookingStatus): string {
  return STATUS_LABEL[s];
}
export function labelToStatus(label: string | null | undefined): BookingStatus | null {
  if (!label) return null;
  return STATUS_FROM_LABEL[label] ?? null;
}
export function bookedByTypeToLabel(t: BookedByType): string {
  return BOOKED_BY_TYPE_LABEL[t];
}
export function labelToBookedByType(label: string | null | undefined): BookedByType | null {
  if (!label) return null;
  return TYPE_FROM_LABEL[label] ?? null;
}

const LUMA_STATUS_FROM_LABEL: Record<string, LumaStatus> = Object.fromEntries(
  Object.entries(LUMA_STATUS_LABEL).map(([k, v]) => [v, k as LumaStatus]),
);
export function lumaStatusToLabel(s: LumaStatus): string {
  return LUMA_STATUS_LABEL[s];
}
export function labelToLumaStatus(label: string | null | undefined): LumaStatus | null {
  if (!label) return null;
  return LUMA_STATUS_FROM_LABEL[label] ?? null;
}

// ---- small Notion property builders ----------------------------------------

const richText = (v: string | null | undefined) => ({
  rich_text: v ? [{ type: "text" as const, text: { content: v.slice(0, 2000) } }] : [],
});
const title = (v: string) => ({
  title: [{ type: "text" as const, text: { content: v.slice(0, 2000) } }],
});
const select = (name: string | null | undefined) => ({ select: name ? { name } : null });
const dateProp = (v: string | null | undefined) => ({ date: v ? { start: v } : null });
const multiSelect = (csv: string | null | undefined) => ({
  multi_select: csv
    ? csv.split(",").map((s) => s.trim()).filter(Boolean).map((name) => ({ name }))
    : [],
});

// ---- hub -> Notion ----------------------------------------------------------

export interface PushOptions {
  /** Slot label to display (e.g. "2:00–2:30 PM"); relations don't cross workspaces. */
  slotLabel?: string | null;
  /** City for the Location select. */
  location?: string | null;
  /** Event name + date for per-event Notion views. */
  eventName?: string | null;
  eventDate?: string | null;
  /** Withhold sensitive fields from this workspace's mirror (PRD §12 / GDPR). */
  omitPhone?: boolean;
  omitChallenge?: boolean;
}

/** Full property set for creating a Notion page from a booking (initial push). */
export function bookingToPageProperties(booking: Booking, opts: PushOptions = {}) {
  const props: Record<string, unknown> = {
    [PROP.guestName]: title(booking.guest_name),
    [PROP.guestEmail]: richText(booking.guest_email),
    [PROP.role]: richText(booking.role),
    [PROP.company]: richText(booking.company),
    [PROP.slot]: richText(opts.slotLabel ?? null),
    [PROP.location]: select(opts.location ?? null),
    [PROP.event]: richText(opts.eventName ?? null),
    [PROP.eventDate]: dateProp(opts.eventDate ?? null),
    [PROP.status]: select(statusToLabel(booking.status)),
    [PROP.bookedByName]: richText(booking.booked_by_display_name),
    [PROP.bookedByType]: select(
      booking.booked_by_type ? bookedByTypeToLabel(booking.booked_by_type) : null,
    ),
    [PROP.lumaGuestId]: richText(booking.luma_guest_id),
    [PROP.lumaStatus]: select(lumaStatusToLabel(booking.luma_status)),
    [PROP.notionEmail]: richText(booking.notion_email),
    [PROP.notionPlan]: select(booking.notion_plan),
    [PROP.experienceLevel]: select(booking.experience_level),
    [PROP.reasons]: multiSelect(booking.attend_reasons),
    [PROP.requestedSlot]: richText(booking.requested_slot),
  };
  if (!opts.omitPhone) props[PROP.guestPhone] = richText(booking.guest_phone);
  if (!opts.omitChallenge) props[PROP.challenge] = richText(booking.challenge);
  return props;
}

/** Just the synced fields, for a hub->Notion update (status change / claim mirror). */
export function syncedFieldsToUpdateProperties(fields: SyncedFields) {
  return {
    [PROP.status]: select(statusToLabel(fields.status)),
    [PROP.bookedByName]: richText(fields.booked_by_display_name),
    [PROP.bookedByType]: select(
      fields.booked_by_type ? bookedByTypeToLabel(fields.booked_by_type) : null,
    ),
    [PROP.lumaStatus]: select(lumaStatusToLabel(fields.luma_status)),
  };
}

/**
 * Properties to FULLY clear a booking on release — includes clearing the native
 * `Booked by` Person (setting people to [] needs no user lookup, so it's safe
 * for the hub to do in any workspace). Used so an unclaim cleans both sides
 * completely, regardless of which workspace triggered it.
 */
export function releaseUpdateProperties() {
  return {
    [PROP.status]: select(statusToLabel("unassigned")),
    [PROP.bookedByName]: richText(null),
    [PROP.bookedByType]: select(null),
    [PROP.bookedByPerson]: { people: [] as unknown[] },
    [PROP.unclaimRequestedBy]: { people: [] as unknown[] },
  };
}

/** Clear just the "Unclaim requested by" chip (deny path — keeps the claim). */
export function clearUnclaimRequestedByProperties() {
  return { [PROP.unclaimRequestedBy]: { people: [] as unknown[] } };
}

// ---- Notion -> hub ----------------------------------------------------------

/** Read a Notion select property's option name (from a fetched page). */
function readSelect(prop: unknown): string | null {
  const p = prop as { select?: { name?: string } | null } | undefined;
  return p?.select?.name ?? null;
}
/** Read a Notion rich_text property's plain text (from a fetched page). */
function readRichText(prop: unknown): string | null {
  const p = prop as { rich_text?: Array<{ plain_text?: string }> } | undefined;
  if (!p?.rich_text?.length) return null;
  return p.rich_text.map((r) => r.plain_text ?? "").join("") || null;
}

/**
 * Read the first person's name from a Notion people property (from a fetched
 * page). Requires the integration to have "Read user information" capability,
 * otherwise the user object won't include `name`. Used so a "Claim" button that
 * sets the native `Booked by` Person to "whoever clicked" is enough — the hub
 * derives the display name that crosses the boundary from it.
 */
export function readFirstPersonName(prop: unknown): string | null {
  const p = prop as { people?: Array<{ name?: string }> } | undefined;
  if (!p?.people?.length) return null;
  return p.people[0]?.name ?? null;
}

/**
 * Read the first person's email from a Notion people property. Requires the
 * integration's "Read user information WITH email addresses" capability;
 * otherwise `person.email` is absent and this returns null.
 */
export function readFirstPersonEmail(prop: unknown): string | null {
  const p = prop as { people?: Array<{ person?: { email?: string } }> } | undefined;
  if (!p?.people?.length) return null;
  return p.people[0]?.person?.email ?? null;
}

/** Read the "Slot" text mirror from a fetched Notion page (for manual slot edits). */
export function readSlotLabelFromPage(properties: Record<string, unknown>): string | null {
  return readRichText(properties[PROP.slot]);
}

/**
 * Parse the synced fields out of a fetched Notion page's `properties` object
 * (Notion→hub direction). We read the page via the API after a webhook rather
 * than trusting the webhook body, since the "Send webhook" payload is
 * properties-only and customizable.
 */
export function pagePropertiesToSyncedFields(
  properties: Record<string, unknown>,
): SyncedFields {
  return {
    status: labelToStatus(readSelect(properties[PROP.status])) ?? "unassigned",
    luma_status: labelToLumaStatus(readSelect(properties[PROP.lumaStatus])) ?? "pending",
    // Prefer the explicit text mirror; fall back to the native "Booked by"
    // Person's name so a "Claim" button (which sets only the Person) works.
    booked_by_display_name:
      readRichText(properties[PROP.bookedByName]) ??
      readFirstPersonName(properties[PROP.bookedByPerson]),
    booked_by_type: labelToBookedByType(readSelect(properties[PROP.bookedByType])),
  };
}
