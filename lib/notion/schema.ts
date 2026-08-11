import type { Client } from "@notionhq/client";
import type { NotionWorkspace } from "./client";

/**
 * The Bookings database schema, per workspace (PRD §6.3), defined as code so we
 * can create it identically in Notion Dev and the Ambassador workspace via the
 * API once the integration tokens land.
 *
 * KEY DESIGN POINT (PRD §6.3, confirmed by Notion API research): the native
 * `Booked by` PEOPLE property is created in each workspace but is NEVER synced —
 * user ids don't port across workspaces. Only the text mirror
 * `Booked by (name)` + `Booked by type` select cross the boundary.
 */

/** Canonical Notion property names — the single source for schema + mappers. */
export const PROP = {
  guestName: "Guest name",
  guestEmail: "Guest email",
  guestPhone: "Guest phone",
  role: "Role",
  company: "Company",
  challenge: "Challenge",
  slot: "Slot",
  location: "Location",
  event: "Event",
  eventDate: "Event date",
  status: "Status",
  bookedByPerson: "Booked by", // native people prop, per-workspace, NOT synced
  bookedByName: "Booked by (name)", // text mirror that DOES cross
  unclaimRequestedBy: "Unclaim requested by", // set to "Whoever clicked" by the Unclaim button; authorises the release
  bookedByType: "Booked by type",
  lumaGuestId: "Luma guest id",
  lumaStatus: "Luma Status",
  notionEmail: "Notion email",
  notionPlan: "Notion plan",
  experienceLevel: "Experience level",
  reasons: "Reasons",
  requestedSlot: "Requested slot",
  filtered: "Filtered", // organizer triage checkbox; hides the card via a per-workspace view filter
} as const;

/** Status select labels (map to booking_status enum in mappers.ts). */
export const STATUS_LABEL = {
  no_help_needed: "No help needed",
  unassigned: "Unassigned",
  assigned: "Assigned",
  checked_in: "Checked In",
  no_show: "No-show",
  cancelled: "Cancelled",
} as const;

export const LUMA_STATUS_LABEL = {
  pending: "Pending",
  approved: "Approved",
  waitlist: "Waitlist",
  declined: "Declined",
} as const;

export const BOOKED_BY_TYPE_LABEL = {
  employee: "Employee",
  ambassador: "Ambassador",
} as const;

/**
 * Property schema for `initial_data_source.properties` on databases.create.
 * `cities` seeds the Location select (option names must not contain commas).
 */
export function buildBookingsProperties(cities: string[] = ["SF", "NYC"]) {
  return {
    [PROP.guestName]: { title: {} },
    [PROP.guestEmail]: { rich_text: {} },
    [PROP.guestPhone]: { rich_text: {} },
    [PROP.role]: { rich_text: {} },
    [PROP.company]: { rich_text: {} },
    [PROP.challenge]: { rich_text: {} },
    [PROP.slot]: { rich_text: {} }, // slot time as text — relations don't cross workspaces
    [PROP.location]: {
      select: { options: cities.map((c) => ({ name: c })) },
    },
    [PROP.event]: { rich_text: {} },
    [PROP.eventDate]: { date: {} },
    [PROP.status]: {
      select: {
        options: [
          { name: STATUS_LABEL.no_help_needed, color: "red" },
          { name: STATUS_LABEL.unassigned, color: "gray" },
          { name: STATUS_LABEL.assigned, color: "blue" },
          { name: STATUS_LABEL.checked_in, color: "green" },
          { name: STATUS_LABEL.no_show, color: "red" },
          { name: STATUS_LABEL.cancelled, color: "orange" },
        ],
      },
    },
    [PROP.bookedByPerson]: { people: {} },
    [PROP.unclaimRequestedBy]: { people: {} },
    [PROP.bookedByName]: { rich_text: {} },
    [PROP.bookedByType]: {
      select: {
        options: [
          { name: BOOKED_BY_TYPE_LABEL.employee, color: "purple" },
          { name: BOOKED_BY_TYPE_LABEL.ambassador, color: "orange" },
        ],
      },
    },
    [PROP.lumaStatus]: {
      select: {
        options: [
          { name: LUMA_STATUS_LABEL.pending, color: "blue" },
          { name: LUMA_STATUS_LABEL.approved, color: "green" },
          { name: LUMA_STATUS_LABEL.waitlist, color: "yellow" },
          { name: LUMA_STATUS_LABEL.declined, color: "red" },
        ],
      },
    },
    [PROP.notionEmail]: { rich_text: {} },
    [PROP.notionPlan]: {
      select: { options: [
        { name: "Enterprise" }, { name: "Business" }, { name: "Plus" }, { name: "Free" },
      ] },
    },
    [PROP.experienceLevel]: { select: { options: [] } },
    [PROP.reasons]: { multi_select: { options: [
      { name: "I need 1:1 help" }, { name: "I want to cowork" }, { name: "Just checking it out" },
    ] } },
    [PROP.requestedSlot]: { rich_text: {} },
    [PROP.filtered]: { checkbox: {} },
    [PROP.lumaGuestId]: { rich_text: {} },
  } as const;
}

export interface CreatedBookingsDb {
  workspace: NotionWorkspace;
  databaseId: string;
  dataSourceId: string;
}

/**
 * Create the Bookings database under a parent page. Returns the database id AND
 * the initial data-source id (row ops target the data source, v2025-09-03+).
 * Run once per workspace; store the returned dataSourceId in env.
 */
export async function createBookingsDatabase(
  notion: Client,
  workspace: NotionWorkspace,
  parentPageId: string,
  cities: string[] = ["SF", "NYC"],
): Promise<CreatedBookingsDb> {
  const res = await notion.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: `Notion Build Bar — Bookings (${workspace})` } }],
    // The properties schema lives on the initial data source in v2025-09-03+.
    initial_data_source: { properties: buildBookingsProperties(cities) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  // The create response carries the new data source(s); extract the first.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyRes = res as any;
  const dataSourceId: string | undefined =
    anyRes?.data_sources?.[0]?.id ?? anyRes?.initial_data_source?.id;
  if (!dataSourceId) {
    throw new Error(
      "createBookingsDatabase: could not read data_source id from response; inspect the raw response shape.",
    );
  }
  return { workspace, databaseId: anyRes.id as string, dataSourceId };
}
