import { describe, it, expect } from "vitest";
import { sendBookingComms, type CommsDeps } from "@/lib/email/comms";
import type { CommsFields } from "@/lib/email/templates";

function fields(p: Partial<CommsFields> = {}): CommsFields {
  return {
    bookingId: "b1", guestName: "Ada", guestEmail: "ada@x.com", company: null, role: null,
    challenge: null, guestPhone: null, slotName: "2:00 PM", slotStartsAt: "2026-08-26T21:00:00Z",
    slotEndsAt: "2026-08-26T21:30:00Z", eventName: "OH", eventDate: "2026-08-26", location: "SF", address: null,
    helperName: "Grace", helperEmail: "grace@x.com", status: "assigned", ...p,
  };
}

function makeDeps(over: Partial<CommsDeps> = {}, f: CommsFields | null = fields()) {
  const sent: Array<{ to: string; hasAttachment: boolean; ics: string }> = [];
  const recorded: Array<{ email: string; status: string }> = [];
  const deps: CommsDeps = {
    getFields: async () => f,
    reserve: async () => true,
    finalize: async (_b, _k, email, o) => { recorded.push({ email, status: o.status }); },
    send: async (i) => {
      sent.push({ to: i.to, hasAttachment: !!i.attachments?.length, ics: i.attachments?.[0]?.content?.toString("utf8") ?? "" });
      return { id: "re_1" };
    },
    enabled: () => true,
    from: () => "Notion Build Bar <hello@oh.com>",
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

  it("invite title is personalized per recipient (guest sees the expert, helper sees the guest)", async () => {
    const { deps, sent } = makeDeps();
    await sendBookingComms("b1", "assigned", deps);
    const guest = sent.find((s) => s.to === "ada@x.com")!;
    const helper = sent.find((s) => s.to === "grace@x.com")!;
    expect(guest.ics).toContain("SUMMARY:Notion Build Bar - Meet Grace");
    expect(helper.ics).toContain("SUMMARY:Notion Build Bar - Meet Ada");
  });

  it("assigned with no helper email → guest only", async () => {
    const { deps, sent } = makeDeps({}, fields({ helperEmail: null }));
    await sendBookingComms("b1", "assigned", deps);
    expect(sent.map((s) => s.to)).toEqual(["ada@x.com"]);
  });

  it("checked_in → helper + guest, no attachment", async () => {
    const { deps, sent } = makeDeps();
    await sendBookingComms("b1", "checked_in", deps);
    expect(sent.map((s) => s.to).sort()).toEqual(["ada@x.com", "grace@x.com"]);
    expect(sent.every((s) => !s.hasAttachment)).toBe(true);
  });

  it("no_show → helper only", async () => {
    const { deps, sent } = makeDeps();
    await sendBookingComms("b1", "no_show", deps);
    expect(sent.map((s) => s.to)).toEqual(["grace@x.com"]);
  });

  it("idempotent: recipients that lose the reservation are not sent", async () => {
    const { deps, sent } = makeDeps({ reserve: async () => false });
    await sendBookingComms("b1", "assigned", deps);
    expect(sent).toHaveLength(0);
  });

  it("reserve is called before send (send-once guard)", async () => {
    const order: string[] = [];
    const { deps } = makeDeps({
      reserve: async () => { order.push("reserve"); return true; },
      send: async () => { order.push("send"); return { id: "re_1" }; },
      finalize: async () => { order.push("finalize"); },
    });
    await sendBookingComms("b1", "no_show", deps);
    expect(order).toEqual(["reserve", "send", "finalize"]);
  });

  it("disabled: reserves then finalizes skipped, does not send", async () => {
    const { deps, sent, recorded } = makeDeps({ enabled: () => false });
    await sendBookingComms("b1", "assigned", deps);
    expect(sent).toHaveLength(0);
    expect(recorded.every((r) => r.status === "skipped")).toBe(true);
    expect(recorded).toHaveLength(2); // helper + guest both reserved+skipped
  });

  it("send failure finalizes failed (retryable) and does not throw", async () => {
    const { deps, recorded } = makeDeps({ send: async () => { throw new Error("boom"); } });
    await expect(sendBookingComms("b1", "assigned", deps)).resolves.toBeUndefined();
    expect(recorded.some((r) => r.status === "failed")).toBe(true);
  });

  it("empty Resend id is treated as a failure", async () => {
    const { deps, recorded } = makeDeps({ send: async () => ({ id: "" }) });
    await sendBookingComms("b1", "no_show", deps); // helper-only kind keeps this focused
    expect(recorded).toEqual([{ email: "grace@x.com", status: "failed" }]);
  });

  it("missing booking → no-op", async () => {
    const { deps, sent } = makeDeps({}, null);
    await sendBookingComms("b1", "assigned", deps);
    expect(sent).toHaveLength(0);
  });
});
