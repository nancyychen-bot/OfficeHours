import { describe, it, expect } from "vitest";
import { selectMatchingSlot } from "@/lib/db/slots";
import type { SlotRow } from "@/lib/sync/types";

function slot(partial: Partial<SlotRow>): SlotRow {
  return {
    id: partial.id ?? "s1",
    event_id: partial.event_id ?? "e1",
    name: partial.name ?? "2:00–2:30 PM",
    starts_at: partial.starts_at ?? "2026-08-15T21:00:00.000Z",
    ends_at: partial.ends_at ?? "2026-08-15T21:30:00.000Z",
    capacity: partial.capacity ?? 1,
    created_at: partial.created_at ?? "2026-07-29T00:00:00.000Z",
    updated_at: partial.updated_at ?? "2026-07-29T00:00:00.000Z",
  };
}

const slots: SlotRow[] = [
  slot({ id: "a", name: "2:00–2:30 PM", starts_at: "2026-08-15T21:00:00.000Z" }),
  slot({ id: "b", name: "2:30–3:00 PM", starts_at: "2026-08-15T21:30:00.000Z" }),
];

describe("selectMatchingSlot", () => {
  it("matches by exact start time first", () => {
    const m = selectMatchingSlot(slots, { startsAt: "2026-08-15T21:30:00.000Z" });
    expect(m?.id).toBe("b");
  });

  it("matches by label case-insensitively when no time given", () => {
    const m = selectMatchingSlot(slots, { label: "2:00–2:30 pm" });
    expect(m?.id).toBe("a");
  });

  it("prefers time match over a conflicting label", () => {
    const m = selectMatchingSlot(slots, {
      startsAt: "2026-08-15T21:30:00.000Z",
      label: "2:00–2:30 PM",
    });
    expect(m?.id).toBe("b");
  });

  it("returns null when nothing matches", () => {
    expect(selectMatchingSlot(slots, { label: "9:00 AM" })).toBeNull();
    expect(selectMatchingSlot(slots, {})).toBeNull();
  });

  it("tolerates dash and spacing differences in the label", () => {
    // en-dash slot name vs hyphen + extra spaces from a Luma dropdown option
    expect(selectMatchingSlot(slots, { label: "2:00 - 2:30 PM" })?.id).toBe("a");
    expect(selectMatchingSlot(slots, { label: "2:30—3:00 pm" })?.id).toBe("b");
  });
});
