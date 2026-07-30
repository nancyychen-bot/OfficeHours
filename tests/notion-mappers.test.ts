import { describe, it, expect } from "vitest";
import {
  statusToLabel,
  labelToStatus,
  labelToBookedByType,
  syncedFieldsToUpdateProperties,
  pagePropertiesToSyncedFields,
} from "@/lib/notion/mappers";
import { PROP } from "@/lib/notion/schema";
import type { SyncedFields } from "@/lib/sync/types";

describe("status label mapping", () => {
  it("round-trips every status", () => {
    for (const s of ["unassigned", "assigned", "checked_in", "no_show"] as const) {
      expect(labelToStatus(statusToLabel(s))).toBe(s);
    }
  });

  it("maps the tricky labels exactly", () => {
    expect(statusToLabel("checked_in")).toBe("Checked In");
    expect(statusToLabel("no_show")).toBe("No-show");
    expect(labelToStatus("No-show")).toBe("no_show");
  });

  it("returns null for unknown labels", () => {
    expect(labelToStatus("garbage")).toBeNull();
    expect(labelToBookedByType(undefined)).toBeNull();
  });
});

describe("syncedFieldsToUpdateProperties (hub -> Notion)", () => {
  it("builds select + rich_text for an assigned booking", () => {
    const fields: SyncedFields = {
      status: "assigned",
      booked_by_display_name: "Jane Doe",
      booked_by_type: "ambassador",
    };
    const props = syncedFieldsToUpdateProperties(fields) as Record<string, any>;
    expect(props[PROP.status].select.name).toBe("Assigned");
    expect(props[PROP.bookedByName].rich_text[0].text.content).toBe("Jane Doe");
    expect(props[PROP.bookedByType].select.name).toBe("Ambassador");
  });

  it("nulls the select when unassigned/empty", () => {
    const fields: SyncedFields = {
      status: "unassigned",
      booked_by_display_name: null,
      booked_by_type: null,
    };
    const props = syncedFieldsToUpdateProperties(fields) as Record<string, any>;
    expect(props[PROP.status].select.name).toBe("Unassigned");
    expect(props[PROP.bookedByName].rich_text).toEqual([]);
    expect(props[PROP.bookedByType].select).toBeNull();
  });
});

describe("pagePropertiesToSyncedFields (Notion -> hub)", () => {
  it("parses a claimed page's properties", () => {
    const properties = {
      [PROP.status]: { select: { name: "Assigned" } },
      [PROP.bookedByName]: { rich_text: [{ plain_text: "Alex Kim" }] },
      [PROP.bookedByType]: { select: { name: "Employee" } },
    };
    const fields = pagePropertiesToSyncedFields(properties as any);
    expect(fields).toEqual({
      status: "assigned",
      booked_by_display_name: "Alex Kim",
      booked_by_type: "employee",
    });
  });

  it("defaults to unassigned when status is missing", () => {
    const fields = pagePropertiesToSyncedFields({} as any);
    expect(fields.status).toBe("unassigned");
    expect(fields.booked_by_display_name).toBeNull();
  });

  it("derives display name from the Person property when the text mirror is empty (Claim button)", () => {
    const properties = {
      [PROP.status]: { select: { name: "Assigned" } },
      [PROP.bookedByName]: { rich_text: [] },
      [PROP.bookedByPerson]: { people: [{ name: "Jordan Lee" }] },
      [PROP.bookedByType]: { select: { name: "Employee" } },
    };
    const fields = pagePropertiesToSyncedFields(properties as any);
    expect(fields.booked_by_display_name).toBe("Jordan Lee");
  });

  it("prefers the text mirror over the Person name when both exist", () => {
    const properties = {
      [PROP.status]: { select: { name: "Assigned" } },
      [PROP.bookedByName]: { rich_text: [{ plain_text: "Text Mirror Name" }] },
      [PROP.bookedByPerson]: { people: [{ name: "Person Name" }] },
    };
    const fields = pagePropertiesToSyncedFields(properties as any);
    expect(fields.booked_by_display_name).toBe("Text Mirror Name");
  });
});
