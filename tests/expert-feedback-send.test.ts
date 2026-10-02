import { describe, it, expect } from "vitest";
import { sendFeedbackForEvent, type FeedbackSendDeps, type FeedbackDetailRow } from "../lib/events/expert-feedback";

function row(id: string, email: string, name: string): FeedbackDetailRow {
  return {
    id, guest_name: `Guest ${id}`, guest_email: `g${id}@x.com`, challenge: null,
    slot_name: id, slot_starts_at: null, booked_by_email: email, booked_by_display_name: name,
    status: "checked_in", event_id: "ev1", event_name: "SF", event_date: "2026-10-01",
  };
}

function makeDeps(over: Partial<FeedbackSendDeps> & Pick<FeedbackSendDeps, "dm">): {
  deps: FeedbackSendDeps;
  created: string[];
  deleted: string[];
  failures: Array<{ email: string; error: string }>;
} {
  const created: string[] = [];
  const deleted: string[] = [];
  const failures: Array<{ email: string; error: string }> = [];
  const deps: FeedbackSendDeps = {
    loadRows: async () => [row("b1", "ok@x.com", "OK"), row("b2", "fail@x.com", "Fail")],
    alreadyPrompted: async () => false,
    createRows: async (rows) => { rows.forEach((r) => created.push(r.expertEmail)); },
    deleteRows: async (_eventId, email) => { deleted.push(email); },
    onFailure: async (_eventId, email, error) => { failures.push({ email, error }); },
    ...over,
  };
  return { deps, created, deleted, failures };
}

describe("sendFeedbackForEvent — failed DMs don't get silently marked as sent", () => {
  it("deletes the rows and logs a failure when the DM fails, and doesn't count it", async () => {
    const { deps, created, deleted, failures } = makeDeps({
      dm: async (email) => (email === "ok@x.com" ? { ok: true } : { ok: false, error: "user_not_found" }),
    });
    const prompted = await sendFeedbackForEvent("ev1", deps);

    expect(prompted).toBe(1); // only the successful one counts
    expect(deleted).toEqual(["fail@x.com"]); // failed expert's rows removed → cron can retry
    expect(deleted).not.toContain("ok@x.com"); // successful expert's rows kept
    expect(failures).toEqual([{ email: "fail@x.com", error: "user_not_found" }]);
    expect(created).toEqual(expect.arrayContaining(["ok@x.com", "fail@x.com"]));
  });

  it("keeps rows and counts the send when the DM succeeds", async () => {
    const { deps, deleted, failures } = makeDeps({ dm: async () => ({ ok: true }) });
    const prompted = await sendFeedbackForEvent("ev1", deps);
    expect(prompted).toBe(2);
    expect(deleted).toEqual([]);
    expect(failures).toEqual([]);
  });

  it("skips experts already prompted (no DM, no row churn)", async () => {
    let dmCalls = 0;
    const { deps, created } = makeDeps({
      alreadyPrompted: async () => true,
      dm: async () => { dmCalls++; return { ok: true }; },
    });
    const prompted = await sendFeedbackForEvent("ev1", deps);
    expect(prompted).toBe(0);
    expect(dmCalls).toBe(0);
    expect(created).toEqual([]);
  });
});
