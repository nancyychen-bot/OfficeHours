import { describe, it, expect } from "vitest";
import { logCategory, toSentLogRows } from "../lib/comms/log";

describe("logCategory", () => {
  it("prefixes with audience and names the kind", () => {
    expect(logCategory("assigned", "guest")).toBe("GUEST · assigned");
    expect(logCategory("day_of_agenda", "helper")).toBe("EXPERT · day_of_agenda");
  });
});

describe("toSentLogRows", () => {
  it("joins email_log to guest names and sorts newest-first", () => {
    const rows = toSentLogRows(
      [
        { booking_id: "b1", event_kind: "assigned", recipient_role: "guest", recipient_email: "a@x.com", status: "sent", created_at: "2026-10-28T03:00:00Z" },
        { booking_id: "b2", event_kind: "day_of_agenda", recipient_role: "helper", recipient_email: "e@x.com", status: "failed", created_at: "2026-10-30T00:00:00Z" },
      ],
      new Map([["b1", "Sanghyun Lee"], ["b2", "Minji Kim"]]),
    );
    expect(rows.map((r) => r.guestName)).toEqual(["Minji Kim", "Sanghyun Lee"]); // newest first
    expect(rows[1].category).toBe("GUEST · assigned");
    expect(rows[0].status).toBe("failed");
  });
});
