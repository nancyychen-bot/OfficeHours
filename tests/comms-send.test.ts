import { describe, it, expect } from "vitest";
import { sendBookingComms, type CommsDeps } from "@/lib/email/comms";
import type { CommsFields } from "@/lib/email/templates";

function fields(p: Partial<CommsFields> = {}): CommsFields {
  return {
    bookingId: "b1", guestName: "Ada", guestEmail: "ada@x.com", company: null, role: null,
    challenge: null, guestPhone: null, slotName: "2:00 PM", slotStartsAt: "2026-08-26T21:00:00Z",
    slotEndsAt: "2026-08-26T21:30:00Z", eventName: "OH", eventDate: "2026-08-26", location: "SF",
    helperName: "Grace", helperEmail: "grace@x.com", status: "assigned", ...p,
  };
}

function makeDeps(over: Partial<CommsDeps> = {}, f: CommsFields | null = fields()) {
  const sent: Array<{ to: string; hasAttachment: boolean }> = [];
  const recorded: Array<{ role: string; status: string }> = [];
  const deps: CommsDeps = {
    getFields: async () => f,
    hasSent: async () => false,
    record: async (r) => { recorded.push({ role: r.role, status: r.status }); },
    send: async (i) => { sent.push({ to: i.to, hasAttachment: !!i.attachments?.length }); return { id: "re_1" }; },
    enabled: () => true,
    from: () => "Office Hours <hello@oh.com>",
    now: () => "2026-07-31T00:00:00Z",
    ...over,
  };
  return { deps, sent, recorded };
}

describe("sendBookingComms", () => {
  it("assigned → emails helper + guest, both with the ics attachment", async () => {
    const { deps, sent } = makeDeps();
    await sendBookingComms("b1", "assigned", deps);
    expect(sent.map((s) => s.to).sort()).toEqual(["ada@x.com", "grace@x.com"]);
    expect(sent.every((s) => s.hasAttachment)).toBe(true);
  });

  it("assigned with no helper email → guest only", async () => {
    const { deps, sent } = makeDeps({}, fields({ helperEmail: null }));
    await sendBookingComms("b1", "assigned", deps);
    expect(sent.map((s) => s.to)).toEqual(["ada@x.com"]);
  });

  it("checked_in → helper only, no attachment", async () => {
    const { deps, sent } = makeDeps();
    await sendBookingComms("b1", "checked_in", deps);
    expect(sent.map((s) => s.to)).toEqual(["grace@x.com"]);
    expect(sent[0].hasAttachment).toBe(false);
  });

  it("no_show → helper only", async () => {
    const { deps, sent } = makeDeps();
    await sendBookingComms("b1", "no_show", deps);
    expect(sent.map((s) => s.to)).toEqual(["grace@x.com"]);
  });

  it("idempotent: already-sent recipients are skipped", async () => {
    const { deps, sent } = makeDeps({ hasSent: async () => true });
    await sendBookingComms("b1", "assigned", deps);
    expect(sent).toHaveLength(0);
  });

  it("disabled: records skipped and does not send", async () => {
    const { deps, sent, recorded } = makeDeps({ enabled: () => false });
    await sendBookingComms("b1", "assigned", deps);
    expect(sent).toHaveLength(0);
    expect(recorded.every((r) => r.status === "skipped")).toBe(true);
  });

  it("send failure is recorded and does not throw", async () => {
    const { deps, recorded } = makeDeps({ send: async () => { throw new Error("boom"); } });
    await expect(sendBookingComms("b1", "assigned", deps)).resolves.toBeUndefined();
    expect(recorded.some((r) => r.status === "failed")).toBe(true);
  });

  it("missing booking → no-op", async () => {
    const { deps, sent } = makeDeps({}, null);
    await sendBookingComms("b1", "assigned", deps);
    expect(sent).toHaveLength(0);
  });
});
